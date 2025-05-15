const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Koneksi ke database SQLite
const db = new sqlite3.Database('./sales.db', (err) => {
  if (err) {
    console.error('Error membuka database:', err.message);
  } else {
    console.log('Terhubung ke database SQLite.');
    // Buat tabel sales jika belum ada
    db.run(`
      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY,
        date TEXT,
        product TEXT,
        quantity INTEGER,
        unitPrice REAL,
        total REAL,
        paymentMethod TEXT,
        status TEXT,
        saleType TEXT,
        paymentStatus TEXT,
        description TEXT,
        branch TEXT
      )
    `);
    // Buat tabel stock jika belum ada
    db.run(`
      CREATE TABLE IF NOT EXISTS stock (
        id TEXT PRIMARY KEY,
        product TEXT,
        branch TEXT,
        quantity INTEGER DEFAULT 0,
        UNIQUE (product, branch)
      )
    `);
    // Buat tabel productions jika belum ada
    db.run(`
      CREATE TABLE IF NOT EXISTS productions (
        id TEXT PRIMARY KEY,
        date TEXT,
        products TEXT,
        description TEXT,
        distributed TEXT DEFAULT '{}'
      )
    `);
    // Inisialisasi stok awal per cabang jika belum ada
    db.all('SELECT COUNT(*) as count FROM stock', [], (err, rows) => {
      if (err) {
        console.error('Error checking stock table:', err.message);
      } else if (rows[0].count === 0) {
        const initialStocks = [
          { product: 'Basreng 100Gr', branch: 'Jablay 1 (Zhidan)', quantity: 100 },
          { product: 'Basreng 200Gr', branch: 'Jablay 1 (Zhidan)', quantity: 100 },
          { product: 'Makaroni 100Gr', branch: 'Jablay 1 (Zhidan)', quantity: 100 },
          { product: 'Makaroni 200Gr', branch: 'Jablay 1 (Zhidan)', quantity: 100 },
          { product: 'Keripik Kaca 50Gr', branch: 'Jablay 1 (Zhidan)', quantity: 100 },
          { product: 'Kripik Kaca 110Gr', branch: 'Jablay 1 (Zhidan)', quantity: 100 },
          { product: 'Singkong 100Gr', branch: 'Jablay 1 (Zhidan)', quantity: 100 },
          { product: 'Basreng 100Gr', branch: 'Jablay 2 (Reyhan)', quantity: 100 },
          { product: 'Basreng 200Gr', branch: 'Jablay 2 (Reyhan)', quantity: 100 },
          { product: 'Makaroni 100Gr', branch: 'Jablay 2 (Reyhan)', quantity: 100 },
          { product: 'Makaroni 200Gr', branch: 'Jablay 2 (Reyhan)', quantity: 100 },
          { product: 'Keripik Kaca 50Gr', branch: 'Jablay 2 (Reyhan)', quantity: 100 },
          { product: 'Kripik Kaca 110Gr', branch: 'Jablay 2 (Reyhan)', quantity: 100 },
          { product: 'Singkong 100Gr', branch: 'Jablay 2 (Reyhan)', quantity: 100 },
          { product: 'Basreng 100Gr', branch: 'Jablay 3 (Tangsel)', quantity: 100 },
          { product: 'Basreng 200Gr', branch: 'Jablay 3 (Tangsel)', quantity: 100 },
          { product: 'Makaroni 100Gr', branch: 'Jablay 3 (Tangsel)', quantity: 100 },
          { product: 'Makaroni 200Gr', branch: 'Jablay 3 (Tangsel)', quantity: 100 },
          { product: 'Keripik Kaca 50Gr', branch: 'Jablay 3 (Tangsel)', quantity: 100 },
          { product: 'Kripik Kaca 110Gr', branch: 'Jablay 3 (Tangsel)', quantity: 100 },
          { product: 'Singkong 100Gr', branch: 'Jablay 3 (Tangsel)', quantity: 100 }
        ];
        const stmt = db.prepare('INSERT INTO stock (id, product, branch, quantity) VALUES (?, ?, ?, ?)');
        initialStocks.forEach((stock, index) => {
          stmt.run(`STK${String(index + 1).padStart(3, '0')}`, stock.product, stock.branch, stock.quantity);
        });
        stmt.finalize();
        console.log('Stok awal per cabang telah diinisialisasi.');
      }
    });
  }
});

// Fungsi untuk generate ID
function generateId(prefix, table) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) as count FROM ${table}`, [], (err, row) => {
      if (err) reject(err);
      else resolve(`${prefix}${String(row.count + 1).padStart(3, '0')}`);
    });
  });
}

// Fungsi untuk mencari stok berdasarkan product dan branch
function findStock(product, branch) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM stock WHERE product = ? AND branch = ?', [product, branch], (err, stock) => {
      if (err) reject(err);
      else resolve(stock);
    });
  });
}

// Fungsi untuk mengupdate atau menambah stok
function updateOrAddStock(product, branch, quantity) {
  return new Promise(async (resolve, reject) => {
    const stock = await findStock(product, branch);
    if (stock) {
      // Update stok yang sudah ada
      db.run('UPDATE stock SET quantity = quantity + ? WHERE product = ? AND branch = ?', [quantity, product, branch], (err) => {
        if (err) reject(err);
        else resolve(stock.id);
      });
    } else {
      // Tambah stok baru
      const stockId = await generateId('STK', 'stock');
      db.run('INSERT INTO stock (id, product, branch, quantity) VALUES (?, ?, ?, ?)', [stockId, product, branch, quantity], (err) => {
        if (err) reject(err);
        else resolve(stockId);
      });
    }
  });
}

// Endpoint: Mendapatkan semua transaksi penjualan
app.get('/api/sales', (req, res) => {
  db.all('SELECT * FROM sales', [], (err, rows) => {
    if (err) {
      console.error('Error saat mengambil data penjualan:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log('Data penjualan yang dikembalikan:', rows);
    res.json(rows);
  });
});

// Endpoint: Menambah transaksi penjualan baru
app.post('/api/sales', async (req, res) => {
  const { date, product, quantity, unitPrice, paymentMethod, status, saleType, paymentStatus, description, branch } = req.body;
  if (!branch || !['Jablay 1 (Zhidan)', 'Jablay 2 (Reyhan)', 'Jablay 3 (Tangsel)'].includes(branch)) {
    res.status(400).json({ error: 'Cabang tidak valid.' });
    return;
  }
  const total = quantity * unitPrice;
  const id = await generateId('TRX', 'sales');

  // Periksa stok untuk cabang tertentu
  db.get('SELECT * FROM stock WHERE product = ? AND branch = ?', [product, branch], async (err, stock) => {
    if (err) {
      console.error('Error saat memeriksa stok:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    if (!stock || stock.quantity < quantity) {
      res.status(400).json({ error: `Stok tidak mencukupi untuk ${product} di cabang ${branch}. Stok tersedia: ${stock ? stock.quantity : 0} unit.` });
      return;
    }

    const sql = `
      INSERT INTO sales (id, date, product, quantity, unitPrice, total, paymentMethod, status, saleType, paymentStatus, description, branch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [id, date, product, quantity, unitPrice, total, paymentMethod, status, saleType, paymentStatus, description || '', branch];
    db.run(sql, params, function (err) {
      if (err) {
        console.error('Error saat menyimpan transaksi:', err.message);
        res.status(500).json({ error: err.message });
        return;
      }

      // Kurangi stok untuk cabang tertentu
      db.run('UPDATE stock SET quantity = quantity - ? WHERE product = ? AND branch = ?', [quantity, product, branch], (err) => {
        if (err) {
          console.error('Error saat mengurangi stok:', err.message);
          res.status(500).json({ error: err.message });
          return;
        }
        console.log('Transaksi penjualan ditambahkan:', { id });
        res.status(201).json({ id });
      });
    });
  });
});

// Endpoint: Mengedit transaksi penjualan
app.put('/api/sales/:id', async (req, res) => {
  const { date, product, quantity, unitPrice, paymentMethod, status, saleType, paymentStatus, description, branch } = req.body;
  if (!branch || !['Jablay 1 (Zhidan)', 'Jablay 2 (Reyhan)', 'Jablay 3 (Tangsel)'].includes(branch)) {
    res.status(400).json({ error: 'Cabang tidak valid.' });
    return;
  }
  const total = quantity * unitPrice;

  // Ambil data transaksi lama
  db.get('SELECT * FROM sales WHERE id = ?', [req.params.id], async (err, oldSale) => {
    if (err) {
      console.error('Error saat mengambil transaksi lama:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    if (!oldSale) {
      res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
      return;
    }

    // Hitung selisih jumlah untuk stok
    const quantityDifference = quantity - oldSale.quantity;

    // Periksa stok jika ada penambahan
    if (quantityDifference > 0) {
      db.get('SELECT * FROM stock WHERE product = ? AND branch = ?', [product, branch], (err, stock) => {
        if (err) {
          console.error('Error saat memeriksa stok:', err.message);
          res.status(500).json({ error: err.message });
          return;
        }
        if (!stock || stock.quantity < quantityDifference) {
          res.status(400).json({ error: `Stok tidak mencukupi untuk ${product} di cabang ${branch}. Stok tersedia: ${stock ? stock.quantity : 0} unit.` });
          return;
        }
        updateTransaction();
      });
    } else {
      updateTransaction();
    }

    function updateTransaction() {
      const sql = `
        UPDATE sales
        SET date = ?, product = ?, quantity = ?, unitPrice = ?, total = ?, paymentMethod = ?, status = ?, saleType = ?, paymentStatus = ?, description = ?, branch = ?
        WHERE id = ?
      `;
      const params = [date, product, quantity, unitPrice, total, paymentMethod, status, saleType || 'onhand', paymentStatus, description || '', branch, req.params.id];
      db.run(sql, params, function (err) {
        if (err) {
          console.error('Error saat mengedit transaksi:', err.message);
          res.status(500).json({ error: err.message });
          return;
        }
        if (this.changes === 0) {
          console.log('Transaksi tidak ditemukan:', req.params.id);
          res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
          return;
        }

        // Update stok untuk cabang tertentu
        db.run('UPDATE stock SET quantity = quantity - ? WHERE product = ? AND branch = ?', [quantityDifference, product, branch], (err) => {
          if (err) {
            console.error('Error saat mengupdate stok:', err.message);
            res.status(500).json({ error: err.message });
            return;
          }
          console.log('Transaksi penjualan diperbarui:', { id: req.params.id });
          res.status(200).json({ message: 'Transaksi diperbarui.' });
        });
      });
    }
  });
});

// Endpoint: Menghapus transaksi penjualan
app.delete('/api/sales/:id', (req, res) => {
  db.get('SELECT * FROM sales WHERE id = ?', [req.params.id], (err, sale) => {
    if (err) {
      console.error('Error saat mengambil transaksi:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    if (!sale) {
      res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
      return;
    }

    const sql = 'DELETE FROM sales WHERE id = ?';
    db.run(sql, req.params.id, function (err) {
      if (err) {
        console.error('Error saat menghapus transaksi:', err.message);
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        console.log('Transaksi tidak ditemukan:', req.params.id);
        res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
        return;
      }

      // Tambah kembali stok untuk cabang tertentu
      db.run('UPDATE stock SET quantity = quantity + ? WHERE product = ? AND branch = ?', [sale.quantity, sale.product, sale.branch], (err) => {
        if (err) {
          console.error('Error saat mengembalikan stok:', err.message);
          res.status(500).json({ error: err.message });
          return;
        }
        console.log('Transaksi penjualan dihapus:', { id: req.params.id });
        res.status(204).send();
      });
    });
  });
});

// Endpoint: Mendapatkan semua stok
app.get('/api/stock', (req, res) => {
  db.all('SELECT * FROM stock', [], (err, rows) => {
    if (err) {
      console.error('Error saat mengambil data stok:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log('Data stok yang dikembalikan:', rows);
    res.json(rows);
  });
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
app.put('/api/stock/:id', (req, res) => {
  const { product, quantity, branch } = req.body;
  if (!branch || !['Jablay 1 (Zhidan)', 'Jablay 2 (Reyhan)', 'Jablay 3 (Tangsel)'].includes(branch)) {
    res.status(400).json({ error: 'Cabang tidak valid.' });
    return;
  }
  if (quantity < 0) {
    res.status(400).json({ error: 'Jumlah stok tidak boleh negatif.' });
    return;
  }

  const sql = 'UPDATE stock SET product = ?, quantity = ?, branch = ? WHERE id = ?';
  db.run(sql, [product, quantity, branch, req.params.id], function (err) {
    if (err) {
      console.error('Error saat mengedit stok:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Stok tidak ditemukan.' });
      return;
    }
    console.log('Stok diperbarui:', { id: req.params.id });
    res.status(200).send();
  });
});

// Endpoint: Menghapus stok
app.delete('/api/stock/:id', (req, res) => {
  const sql = 'DELETE FROM stock WHERE id = ?';
  db.run(sql, req.params.id, function (err) {
    if (err) {
      console.error('Error saat menghapus stok:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Stok tidak ditemukan.' });
      return;
    }
    console.log('Stok dihapus:', { id: req.params.id });
    res.status(204).send();
  });
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

  // Periksa stok di cabang asal
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
    // Kurangi stok di cabang asal
    await new Promise((resolve, reject) => {
      db.run('UPDATE stock SET quantity = quantity - ? WHERE product = ? AND branch = ?', [quantity, product, fromBranch], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Tambah stok di cabang tujuan
    await updateOrAddStock(product, toBranch, quantity);

    console.log(`Stok dipindahkan: ${quantity} unit ${product} dari ${fromBranch} ke ${toBranch}`);
    res.status(200).json({ message: 'Stok berhasil dipindahkan.' });
  } catch (err) {
    console.error('Error saat memindahkan stok:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Mendapatkan semua catatan produksi
app.get('/api/productions', (req, res) => {
  db.all('SELECT * FROM productions', [], (err, rows) => {
    if (err) {
      console.error('Error saat mengambil data produksi:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    const parsedRows = rows.map(row => ({
      ...row,
      products: JSON.parse(row.products || '[]'),
      distributed: JSON.parse(row.distributed || '{}')
    }));
    console.log('Data produksi yang dikembalikan:', parsedRows);
    res.json(parsedRows);
  });
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
    INSERT INTO productions (id, date, products, description, distributed)
    VALUES (?, ?, ?, ?, ?)
  `;
  const params = [id, date, JSON.stringify(products), description || '', JSON.stringify(distributed || {})];
  db.run(sql, params, function (err) {
    if (err) {
      console.error('Error saat menambah catatan produksi:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log('Catatan produksi ditambahkan:', { id });
    res.status(201).json({ id });
  });
});

// Endpoint: Mengupdate catatan produksi (untuk distribusi)
app.put('/api/productions/:id', async (req, res) => {
  const { date, products, description, distributed } = req.body;
  if (!Array.isArray(products) || !distributed || typeof distributed !== 'object') {
    res.status(400).json({ error: 'Data produksi atau distribusi tidak valid.' });
    return;
  }

  // Ambil data produksi lama
  db.get('SELECT * FROM productions WHERE id = ?', [req.params.id], async (err, production) => {
    if (err) {
      console.error('Error saat mengambil catatan produksi:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    if (!production) {
      res.status(404).json({ error: 'Catatan produksi tidak ditemukan.' });
      return;
    }

    try {
      // Validasi distribusi
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

      // Update catatan produksi
      const sql = `
        UPDATE productions
        SET date = ?, products = ?, description = ?, distributed = ?
        WHERE id = ?
      `;
      const params = [date, JSON.stringify(products), description || '', JSON.stringify(distributed), req.params.id];
      db.run(sql, params, function (err) {
        if (err) {
          console.error('Error saat mengupdate catatan produksi:', err.message);
          res.status(500).json({ error: err.message });
          return;
        }
        if (this.changes === 0) {
          res.status(404).json({ error: 'Catatan produksi tidak ditemukan.' });
          return;
        }
        console.log('Catatan produksi diperbarui:', { id: req.params.id });
        res.status(200).send();
      });
    } catch (error) {
      console.error('Error saat mendistribusikan:', error.message);
      res.status(400).json({ error: error.message });
    }
  });
});

// Endpoint: Menghapus catatan produksi
app.delete('/api/productions/:id', (req, res) => {
  db.get('SELECT * FROM productions WHERE id = ?', [req.params.id], (err, production) => {
    if (err) {
      console.error('Error saat mengambil catatan produksi:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    if (!production) {
      res.status(404).json({ error: 'Catatan produksi tidak ditemukan.' });
      return;
    }

    const distributed = JSON.parse(production.distributed || '{}');
    if (Object.keys(distributed).length > 0) {
      res.status(400).json({ error: 'Catatan produksi yang sudah didistribusikan tidak dapat dihapus.' });
      return;
    }

    const sql = 'DELETE FROM productions WHERE id = ?';
    db.run(sql, req.params.id, function (err) {
      if (err) {
        console.error('Error saat menghapus catatan produksi:', err.message);
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        res.status(404).json({ error: 'Catatan produksi tidak ditemukan.' });
        return;
      }
      console.log('Catatan produksi dihapus:', { id: req.params.id });
      res.status(204).send();
    });
  });
});

// Endpoint: Mendapatkan ringkasan penjualan (total keluar per produk dan cabang)
app.get('/api/sales/summary', (req, res) => {
  db.all(`
    SELECT branch, product, SUM(quantity) as totalSold
    FROM sales
    GROUP BY branch, product
  `, [], (err, rows) => {
    if (err) {
      console.error('Error saat mengambil ringkasan penjualan:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }

    const summary = {};
    rows.forEach(row => {
      if (!summary[row.branch]) summary[row.branch] = {};
      summary[row.branch][row.product] = row.totalSold;
    });

    // Tambahkan total per cabang
    const branchTotals = {};
    rows.forEach(row => {
      branchTotals[row.branch] = (branchTotals[row.branch] || 0) + row.totalSold;
    });

    Object.keys(summary).forEach(branch => {
      summary[branch]['__total__'] = branchTotals[branch] || 0;
    });

    console.log('Ringkasan penjualan:', summary);
    res.json(summary);
  });
});

// Jalankan server
app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});