require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const cors = require('cors');
const express = require('express');
const { Pool } = require('pg'); // Pakai pg untuk PostgreSQL

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Konfigurasi CORS
const corsOptions = {
  origin: 'https://audit-sijablay.vercel.app', // Ganti dengan domain frontend Anda
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json());

// Koneksi ke database PostgreSQL (Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
  if (err) {
    console.error('Error membuka database:', err.message);
  } else {
    console.log('Terhubung ke database PostgreSQL.');
    // Buat tabel sales jika belum ada
    pool.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY,
        "date" TEXT,
        "product" TEXT,
        "quantity" INTEGER,
        "unitPrice" REAL,
        "total" REAL,
        "paymentMethod" TEXT,
        "status" TEXT,
        "saleType" TEXT,
        "paymentStatus" TEXT,
        "description" TEXT,
        "branch" TEXT
      )
    `);
    // Buat tabel stock jika belum ada
    pool.query(`
      CREATE TABLE IF NOT EXISTS stock (
        id TEXT PRIMARY KEY,
        "product" TEXT,
        "branch" TEXT,
        "quantity" INTEGER DEFAULT 0,
        CONSTRAINT unique_product_branch UNIQUE ("product", "branch")
      )
    `);
    // Buat tabel productions jika belum ada
    pool.query(`
      CREATE TABLE IF NOT EXISTS productions (
        id TEXT PRIMARY KEY,
        "date" TEXT,
        "products" TEXT,
        "description" TEXT,
        "distributed" TEXT DEFAULT '{}'
      )
    `);
    // Inisialisasi stok awal per cabang jika belum ada
    pool.query('SELECT COUNT(*) as count FROM stock', (err, result) => {
      if (err) {
        console.error('Error checking stock table:', err.message);
      } else if (result.rows[0].count == 0) {
        const initialStocks = [];
        const insertQuery = 'INSERT INTO stock (id, "product", "branch", "quantity") VALUES ($1, $2, $3, $4)';
        initialStocks.forEach((stock, index) => {
          pool.query(insertQuery, [`STK${String(index + 1).padStart(3, '0')}`, stock.product, stock.branch, stock.quantity], (err) => {
            if (err) console.error('Error inserting stock:', err.message);
          });
        });
        console.log('Stok awal per cabang telah diinisialisasi.');
      }
    });
  }
});

// Fungsi untuk generate ID
async function generateId(prefix, table) {
  const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
  const count = parseInt(result.rows[0].count) + 1;
  return `${prefix}${String(count).padStart(3, '0')}`;
}

// Fungsi untuk mencari stok berdasarkan product dan branch
async function findStock(product, branch) {
  const result = await pool.query('SELECT * FROM stock WHERE "product" = $1 AND "branch" = $2', [product, branch]);
  return result.rows[0];
}

// Fungsi untuk mengupdate atau menambah stok
async function updateOrAddStock(product, branch, quantity) {
  const stock = await findStock(product, branch);
  if (stock) {
    // Update stok yang sudah ada
    await pool.query('UPDATE stock SET "quantity" = "quantity" + $1 WHERE "product" = $2 AND "branch" = $3', [quantity, product, branch]);
    return stock.id;
  } else {
    // Tambah stok baru
    const stockId = await generateId('STK', 'stock');
    await pool.query('INSERT INTO stock (id, "product", "branch", "quantity") VALUES ($1, $2, $3, $4)', [stockId, product, branch, quantity]);
    return stockId;
  }
}

// Endpoint: Mendapatkan semua transaksi penjualan
app.get('/api/sales', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sales');
    console.log('Data penjualan yang dikembalikan:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error saat mengambil data penjualan:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Menambah transaksi penjualan baru
app.post('/api/sales', async (req, res) => {
  console.log('Data yang diterima dari frontend:', req.body);
  const { date, product, quantity, unitPrice, paymentMethod, status, saleType, paymentStatus, description, branch } = req.body;
  if (!branch || !['Jablay 1 (Zhidan)', 'Jablay 2 (Reyhan)', 'Jablay 3 (Tangsel)'].includes(branch)) {
    res.status(400).json({ error: 'Cabang tidak valid.' });
    return;
  }
  const total = quantity * unitPrice;
  const id = await generateId('TRX', 'sales');

  const stockResult = await pool.query('SELECT * FROM stock WHERE "product" = $1 AND "branch" = $2', [product, branch]);
  const stock = stockResult.rows[0];
  if (!stock || stock.quantity < quantity) {
    res.status(400).json({ error: `Stok tidak mencukupi untuk ${product} di cabang ${branch}. Stok tersedia: ${stock ? stock.quantity : 0} unit.` });
    return;
  }

  const sql = `
    INSERT INTO sales (id, "date", "product", "quantity", "unitPrice", "total", "paymentMethod", "status", "saleType", "paymentStatus", "description", "branch")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `;
  const params = [id, date, product, quantity, unitPrice, total, paymentMethod, status, saleType, paymentStatus, description || '', branch];
  try {
    await pool.query(sql, params);
    await pool.query('UPDATE stock SET "quantity" = "quantity" - $1 WHERE "product" = $2 AND "branch" = $3', [quantity, product, branch]);
    console.log('Transaksi penjualan ditambahkan:', { id });
    res.status(201).json({ id });
  } catch (err) {
    console.error('Error saat menyimpan transaksi:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Mengedit transaksi penjualan
app.put('/api/sales/:id', async (req, res) => {
  const { date, product, quantity, unitPrice, paymentMethod, status, saleType, paymentStatus, description, branch } = req.body;
  if (!branch || !['Jablay 1 (Zhidan)', 'Jablay 2 (Reyhan)', 'Jablay 3 (Tangsel)'].includes(branch)) {
    res.status(400).json({ error: 'Cabang tidak valid.' });
    return;
  }
  const total = quantity * unitPrice;

  const oldSaleResult = await pool.query('SELECT * FROM sales WHERE id = $1', [req.params.id]);
  const oldSale = oldSaleResult.rows[0];
  if (!oldSale) {
    res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
    return;
  }

  const quantityDifference = quantity - oldSale.quantity;

  if (quantityDifference > 0) {
    const stockResult = await pool.query('SELECT * FROM stock WHERE "product" = $1 AND "branch" = $2', [product, branch]);
    const stock = stockResult.rows[0];
    if (!stock || stock.quantity < quantityDifference) {
      res.status(400).json({ error: `Stok tidak mencukupi untuk ${product} di cabang ${branch}. Stok tersedia: ${stock ? stock.quantity : 0} unit.` });
      return;
    }
  }

  const sql = `
    UPDATE sales
    SET "date" = $1, "product" = $2, "quantity" = $3, "unitPrice" = $4, "total" = $5, "paymentMethod" = $6, "status" = $7, "saleType" = $8, "paymentStatus" = $9, "description" = $10, "branch" = $11
    WHERE id = $12
  `;
  const params = [date, product, quantity, unitPrice, total, paymentMethod, status, saleType || 'onhand', paymentStatus, description || '', branch, req.params.id];
  try {
    const result = await pool.query(sql, params);
    if (result.rowCount === 0) {
      console.log('Transaksi tidak ditemukan:', req.params.id);
      res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
      return;
    }

    await pool.query('UPDATE stock SET "quantity" = "quantity" - $1 WHERE "product" = $2 AND "branch" = $3', [quantityDifference, product, branch]);
    console.log('Transaksi penjualan diperbarui:', { id: req.params.id });
    res.status(200).json({ message: 'Transaksi diperbarui.' });
  } catch (err) {
    console.error('Error saat mengedit transaksi:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Menghapus transaksi penjualan
app.delete('/api/sales/:id', async (req, res) => {
  const saleResult = await pool.query('SELECT * FROM sales WHERE id = $1', [req.params.id]);
  const sale = saleResult.rows[0];
  if (!sale) {
    res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
    return;
  }

  try {
    const result = await pool.query('DELETE FROM sales WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      console.log('Transaksi tidak ditemukan:', req.params.id);
      res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
      return;
    }

    await pool.query('UPDATE stock SET "quantity" = "quantity" + $1 WHERE "product" = $2 AND "branch" = $3', [sale.quantity, sale.product, sale.branch]);
    console.log('Transaksi penjualan dihapus:', { id: req.params.id });
    res.status(204).send();
  } catch (err) {
    console.error('Error saat menghapus transaksi:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Mendapatkan semua stok
app.get('/api/stock', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM stock');
    console.log('Data stok yang dikembalikan:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error saat mengambil data stok:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Menambah atau memperbarui stok
app.post('/api/stock', async (req, res) => {
  const { product, quantity, branch } = req.body;
  if (!branch || !['Jablay 1 (Zhidan)', 'Jablay 2 (Reyhan)', 'Jablay 3 (Tangsel)'].includes(branch)) {
    res.status(400).json({ error: 'Cabang tidak valid.' });
    return;
  }
  if (quantity < 0) {
    res.status(400).json({ error: 'Jumlah stok tidak boleh negatif.' });
    return;
  }

  try {
    const stockId = await updateOrAddStock(product, branch, quantity);
    res.status(201).json({ id: stockId });
  } catch (err) {
    console.error('Error saat menambah/memperbarui stok:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Mengedit stok
app.put('/api/stock/:id', async (req, res) => {
  const { product, quantity, branch } = req.body;
  if (!branch || !['Jablay 1 (Zhidan)', 'Jablay 2 (Reyhan)', 'Jablay 3 (Tangsel)'].includes(branch)) {
    res.status(400).json({ error: 'Cabang tidak valid.' });
    return;
  }
  if (quantity < 0) {
    res.status(400).json({ error: 'Jumlah stok tidak boleh negatif.' });
    return;
  }

  const sql = 'UPDATE stock SET "product" = $1, "quantity" = $2, "branch" = $3 WHERE id = $4';
  try {
    const result = await pool.query(sql, [product, quantity, branch, req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Stok tidak ditemukan.' });
      return;
    }
    console.log('Stok diperbarui:', { id: req.params.id });
    res.status(200).send();
  } catch (err) {
    console.error('Error saat mengedit stok:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Menghapus stok
app.delete('/api/stock/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM stock WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Stok tidak ditemukan.' });
      return;
    }
    console.log('Stok dihapus:', { id: req.params.id });
    res.status(204).send();
  } catch (err) {
    console.error('Error saat menghapus stok:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Memindahkan stok antar cabang
app.post('/api/stock/transfer', async (req, res) => {
  const { product, quantity, fromBranch, toBranch } = req.body;

  if (!fromBranch || !['Jablay 1 (Zhidan)', 'Jablay 2 (Reyhan)', 'Jablay 3 (Tangsel)'].includes(fromBranch)) {
    res.status(400).json({ error: 'Cabang asal tidak valid.' });
    return;
  }
  if (!toBranch || !['Jablay 1 (Zhidan)', 'Jablay 2 (Reyhan)', 'Jablay 3 (Tangsel)'].includes(toBranch)) {
    res.status(400).json({ error: 'Cabang tujuan tidak valid.' });
    return;
  }
  if (fromBranch === toBranch) {
    res.status(400).json({ error: 'Cabang asal dan tujuan tidak boleh sama.' });
    return;
  }
  if (quantity <= 0) {
    res.status(400).json({ error: 'Jumlah yang dipindahkan harus lebih dari 0.' });
    return;
  }

  const fromStock = await findStock(product, fromBranch);
  if (!fromStock) {
    res.status(404).json({ error: `Stok untuk ${product} di ${fromBranch} tidak ditemukan.` });
    return;
  }
  if (fromStock.quantity < quantity) {
    res.status(400).json({ error: `Stok tidak mencukupi di ${fromBranch}. Stok tersedia: ${fromStock.quantity} unit.` });
    return;
  }

  try {
    await pool.query('UPDATE stock SET "quantity" = "quantity" - $1 WHERE "product" = $2 AND "branch" = $3', [quantity, product, fromBranch]);
    await updateOrAddStock(product, toBranch, quantity);
    console.log(`Stok dipindahkan: ${quantity} unit ${product} dari ${fromBranch} ke ${toBranch}`);
    res.status(200).json({ message: 'Stok berhasil dipindahkan.' });
  } catch (err) {
    console.error('Error saat memindahkan stok:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Mendapatkan semua catatan produksi
app.get('/api/productions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM productions');
    const parsedRows = result.rows.map(row => ({
      ...row,
      products: JSON.parse(row.products || '[]'),
      distributed: JSON.parse(row.distributed || '{}')
    }));
    console.log('Data produksi yang dikembalikan:', parsedRows);
    res.json(parsedRows);
  } catch (err) {
    console.error('Error saat mengambil data produksi:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Menambah catatan produksi baru
app.post('/api/productions', async (req, res) => {
  const { date, products, description, distributed } = req.body;
  if (!Array.isArray(products)) {
    res.status(400).json({ error: 'Data produk tidak valid.' });
    return;
  }
  const nonZeroProducts = products.filter(p => p.quantity > 0);
  if (nonZeroProducts.length === 0) {
    res.status(400).json({ error: 'Harap masukkan setidaknya satu produk dengan jumlah lebih dari 0.' });
    return;
  }
  if (products.some(p => p.quantity < 0)) {
    res.status(400).json({ error: 'Jumlah produksi tidak boleh negatif.' });
    return;
  }

  const id = await generateId('PRD', 'productions');
  const sql = `
    INSERT INTO productions (id, "date", "products", "description", "distributed")
    VALUES ($1, $2, $3, $4, $5)
  `;
  const params = [id, date, JSON.stringify(products), description || '', JSON.stringify(distributed || {})];
  try {
    await pool.query(sql, params);
    console.log('Catatan produksi ditambahkan:', { id });
    res.status(201).json({ id });
  } catch (err) {
    console.error('Error saat menambah catatan produksi:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Mengupdate catatan produksi (untuk distribusi)
app.put('/api/productions/:id', async (req, res) => {
  console.log(`[${new Date().toISOString()}] Distribusi dimulai untuk production ID: ${req.params.id}, Data:`, req.body);
  const { date, products, description, distributed } = req.body;
  if (!Array.isArray(products) || !distributed || typeof distributed !== 'object') {
    res.status(400).json({ error: 'Data produksi atau distribusi tidak valid.' });
    return;
  }

  // Mulai transaksi untuk mencegah race condition
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Lock baris production untuk mencegah akses bersamaan
    const productionResult = await client.query(
      'SELECT * FROM productions WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    const production = productionResult.rows[0];
    if (!production) {
      throw new Error('Catatan produksi tidak ditemukan.');
    }

    // Cek apakah sudah didistribusikan
    const existingDistributed = JSON.parse(production.distributed || '{}');
    if (Object.keys(existingDistributed).length > 0) {
      throw new Error('Catatan produksi ini sudah didistribusikan.');
    }

    const oldProducts = JSON.parse(production.products || '[]');
    for (const [productName, branchQuantities] of Object.entries(distributed)) {
      const product = oldProducts.find(p => p.product === productName);
      if (!product) {
        throw new Error(`Produk ${productName} tidak ditemukan dalam catatan produksi.`);
      }
      const totalDistributed = Object.values(branchQuantities).reduce((sum, qty) => sum + qty, 0);
      if (totalDistributed !== product.quantity) {
        throw new Error(`Jumlah yang didistribusikan untuk ${productName} (${totalDistributed}) harus sama dengan jumlah produksi (${product.quantity}).`);
      }
      for (const [branch, qty] of Object.entries(branchQuantities)) {
        if (!['Jablay 1 (Zhidan)', 'Jablay 2 (Reyhan)', 'Jablay 3 (Tangsel)'].includes(branch)) {
          throw new Error(`Cabang ${branch} tidak valid.`);
        }
        if (qty < 0) {
          throw new Error(`Jumlah untuk ${branch} tidak boleh negatif.`);
        }
        if (qty > 0) {
          await updateOrAddStock(productName, branch, qty);
        }
      }
    }

    const sql = `
      UPDATE productions
      SET "date" = $1, "products" = $2, "description" = $3, "distributed" = $4
      WHERE id = $5
    `;
    const params = [date, JSON.stringify(products), description || '', JSON.stringify(distributed), req.params.id];
    const result = await client.query(sql, params);
    if (result.rowCount === 0) {
      throw new Error('Catatan produksi tidak ditemukan.');
    }

    await client.query('COMMIT');
    console.log(`[${new Date().toISOString()}] Catatan produksi diperbarui:`, { id: req.params.id });
    res.status(200).send();
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[${new Date().toISOString()}] Error saat mendistribusikan:`, error.message);
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Endpoint: Menghapus catatan produksi
app.delete('/api/productions/:id', async (req, res) => {
  const productionResult = await pool.query('SELECT * FROM productions WHERE id = $1', [req.params.id]);
  const production = productionResult.rows[0];
  if (!production) {
    res.status(404).json({ error: 'Catatan produksi tidak ditemukan.' });
    return;
  }

  const distributed = JSON.parse(production.distributed || '{}');
  if (Object.keys(distributed).length > 0) {
    res.status(400).json({ error: 'Catatan produksi yang sudah didistribusikan tidak dapat dihapus.' });
    return;
  }

  try {
    const result = await pool.query('DELETE FROM productions WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Catatan produksi tidak ditemukan.' });
      return;
    }
    console.log('Catatan produksi dihapus:', { id: req.params.id });
    res.status(204).send();
  } catch (err) {
    console.error('Error saat menghapus catatan produksi:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Mendapatkan ringkasan penjualan (total keluar per produk dan cabang)
app.get('/api/sales/summary', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT TRIM("branch") as branch, TRIM("product") as product, COALESCE(SUM("quantity"), 0) as totalSold
      FROM sales
      GROUP BY TRIM("branch"), TRIM("product")
    `);
    console.log('Raw query result:', result.rows);
    const summary = {
      'Jablay 1 (Zhidan)': {},
      'Jablay 2 (Reyhan)': {},
      'Jablay 3 (Tangsel)': {}
    };
    result.rows.forEach(row => {
      console.log('Row data:', row);
      console.log('Type of totalSold:', typeof row.totalSold); // Log tipe data
      const totalSoldValue = Number(row.totalSold); // Gunakan Number untuk konversi
      if (['Jablay 1 (Zhidan)', 'Jablay 2 (Reyhan)', 'Jablay 3 (Tangsel)'].includes(row.branch)) {
        if (!summary[row.branch]) summary[row.branch] = {};
        summary[row.branch][row.product] = isNaN(totalSoldValue) ? 0 : totalSoldValue;
      }
    });

    const branchTotals = {};
    result.rows.forEach(row => {
      const totalSoldValue = Number(row.totalSold);
      const totalSold = isNaN(totalSoldValue) ? 0 : totalSoldValue;
      console.log(`Adding to ${row.branch}: ${totalSold}`);
      if (['Jablay 1 (Zhidan)', 'Jablay 2 (Reyhan)', 'Jablay 3 (Tangsel)'].includes(row.branch)) {
        branchTotals[row.branch] = (branchTotals[row.branch] || 0) + totalSold;
      }
    });

    ['Jablay 1 (Zhidan)', 'Jablay 2 (Reyhan)', 'Jablay 3 (Tangsel)'].forEach(branch => {
      summary[branch]['__total__'] = branchTotals[branch] || 0;
    });

    console.log('Ringkasan penjualan:', summary);
    res.json(summary);
  } catch (err) {
    console.error('Error saat mengambil ringkasan penjualan:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Jalankan server
app.listen(port, () => {
  console.log(`Server berjalan di port ${port}`);
});