require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// Конфигурация
const config = {
    ldapUrl: process.env.LDAP_URL || 'https://ldap.itschool25.ru/api/auth',
    apiToken: process.env.API_TOKEN || 'default_api_token_change_me',
    jwtSecret: process.env.JWT_SECRET || 'your_jwt_secret_key_change_in_production',
    adminUsernames: (process.env.ADMIN_USERNAMES || '').split(',').map(u => u.trim()).filter(u => u)
};

// Создаем папку data если её нет
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('✅ Папка data создана');
}

// Инициализация базы данных
const dbPath = path.join(dataDir, 'applications.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Ошибка подключения к базе данных:', err.message);
    } else {
        console.log('✅ Подключение к SQLite базе данных установлено');
        console.log('📁 База данных создана в:', dbPath);
        initializeDatabase();
    }
});

// Инициализация таблиц
function initializeDatabase() {
    const createTableSQL = `
        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            full_name TEXT NOT NULL,
            subject TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            need_date TEXT NOT NULL,
            link TEXT,
            status TEXT DEFAULT 'active',
            priority TEXT DEFAULT 'normal',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;
    
    db.run(createTableSQL, (err) => {
        if (err) {
            console.error('❌ Ошибка создания таблицы:', err.message);
            return;
        }
        
        console.log('✅ Таблица applications готова');
        checkAndAddColumns();
    });
}

// Функция для проверки и добавления колонок
function checkAndAddColumns() {
    const columnsToCheck = [
        { name: 'status', type: 'TEXT DEFAULT "active"' },
        { name: 'priority', type: 'TEXT DEFAULT "normal"' },
        { name: 'updated_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' }
    ];

    db.all("PRAGMA table_info(applications)", (err, rows) => {
        if (err) {
            console.error('❌ Ошибка при проверке структуры таблицы:', err.message);
            return;
        }

        const existingColumns = rows ? rows.map(row => row.name) : [];
        
        columnsToCheck.forEach(column => {
            if (!existingColumns.includes(column.name)) {
                db.run(`ALTER TABLE applications ADD COLUMN ${column.name} ${column.type}`, (err) => {
                    if (err) {
                        console.error(`❌ Ошибка добавления столбца ${column.name}:`, err.message);
                    } else {
                        console.log(`✅ Столбец ${column.name} добавлен`);
                    }
                });
            }
        });
    });
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));
app.use(express.static(path.join(__dirname, 'views')));
app.use(express.urlencoded({ extended: true }));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// Аутентификация
app.post('/api/auth', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Логин и пароль обязательны' });
        }

        // LDAP аутентификация
        const ldapResponse = await axios.post(config.ldapUrl, {
            username,
            password
        }, {
            timeout: 10000,
            validateStatus: function (status) {
                return status < 500;
            }
        });

        const userData = ldapResponse.data;

        if (!userData.success) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }

        // Проверяем, является ли пользователь администратором
        const isAdmin = config.adminUsernames.includes(username);

        // Генерация JWT токена
        const token = jwt.sign(
            { 
                username: userData.username, 
                fullName: userData.full_name,
                isAdmin: isAdmin
            },
            config.jwtSecret,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            token,
            user: userData.full_name,
            username: userData.username,
            isAdmin: isAdmin
        });

    } catch (error) {
        console.error('❌ Ошибка аутентификации:', error.message);
        
        if (error.code === 'ECONNABORTED') {
            return res.status(408).json({ error: 'Таймаут подключения к серверу аутентификации' });
        }
        
        if (error.response) {
            return res.status(error.response.status).json({ 
                error: 'Ошибка аутентификации на сервере' 
            });
        }
        
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Middleware для проверки JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = authHeader;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    }

    if (!token) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    jwt.verify(token, config.jwtSecret, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Неверный токен' });
        }
        req.user = user;
        next();
    });
}

// Middleware для проверки API токена
function authenticateApiToken(req, res, next) {
    const token = req.headers['authorization'];
    
    if (token !== config.apiToken) {
        return res.status(401).json({ error: 'Неверный API токен' });
    }
    next();
}

// Middleware для проверки прав администратора
function requireAdmin(req, res, next) {
    if (!req.user.isAdmin) {
        return res.status(403).json({ error: 'Требуются права администратора' });
    }
    next();
}

// Создание заявки
app.post('/api/applications', authenticateToken, (req, res) => {
    const { subject, quantity, need_date, link, priority = 'normal' } = req.body;
    const { username, fullName } = req.user;

    if (!subject || !quantity || !need_date) {
        return res.status(400).json({ 
            error: 'Название предмета, количество и дата обязательны' 
        });
    }

    if (quantity < 1) {
        return res.status(400).json({ 
            error: 'Количество должно быть не менее 1' 
        });
    }

    const allowedPriorities = ['normal', 'high', 'urgent'];
    if (!allowedPriorities.includes(priority)) {
        return res.status(400).json({ error: 'Неверный приоритет' });
    }

    const sql = `INSERT INTO applications (username, full_name, subject, quantity, need_date, link, priority) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    
    db.run(sql, [username, fullName, subject, quantity, need_date, link || '', priority], function(err) {
        if (err) {
            console.error('❌ Ошибка сохранения заявки:', err.message);
            return res.status(500).json({ error: 'Ошибка сохранения заявки' });
        }

        console.log(`✅ Создана заявка #${this.lastID} от пользователя ${username}`);
        
        res.json({
            success: true,
            id: this.lastID,
            message: 'Заявка успешно создана'
        });
    });
});

// Получение заявок текущего пользователя
app.get('/api/my-applications', authenticateToken, (req, res) => {
    const { username } = req.user;
    const { status = 'all', priority = 'all' } = req.query;
    
    let sql = `SELECT * FROM applications WHERE username = ?`;
    const params = [username];
    
    if (status && status !== 'all') {
        sql += ` AND status = ?`;
        params.push(status);
    }
    
    if (priority && priority !== 'all') {
        sql += ` AND priority = ?`;
        params.push(priority);
    }
    
    sql += ` ORDER BY 
        CASE priority 
            WHEN 'urgent' THEN 1
            WHEN 'high' THEN 2
            WHEN 'normal' THEN 3
            ELSE 4
        END,
        created_at DESC`;

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('❌ Ошибка получения заявок:', err.message);
            return res.status(500).json({ error: 'Ошибка получения заявок' });
        }

        const formattedRows = rows.map(row => ({
            ...row,
            created_at: formatDate(row.created_at),
            need_date: formatDate(row.need_date)
        }));

        res.json({
            success: true,
            applications: formattedRows,
            count: rows.length
        });
    });
});

// Обновление статуса заявки (для обычных пользователей)
app.patch('/api/applications/:id/status', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const { username } = req.user;

    const allowedStatuses = ['active', 'cancelled'];
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Неверный статус' });
    }

    const sql = `UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ? AND username = ?`;
    
    db.run(sql, [status, id, username], function(err) {
        if (err) {
            console.error('❌ Ошибка обновления статуса:', err.message);
            return res.status(500).json({ error: 'Ошибка обновления статуса' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'Заявка не найдена или у вас нет прав' });
        }

        res.json({
            success: true,
            message: `Статус заявки обновлен на "${getStatusText(status)}"`
        });
    });
});

// Обновление статуса заявки администратором
app.patch('/api/applications/:id/admin-status', authenticateToken, requireAdmin, (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ['active', 'completed', 'cancelled'];
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Неверный статус' });
    }

    const sql = `UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`;
    
    db.run(sql, [status, id], function(err) {
        if (err) {
            console.error('❌ Ошибка обновления статуса администратором:', err.message);
            return res.status(500).json({ error: 'Ошибка обновления статуса' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }

        res.json({
            success: true,
            message: `Статус заявки обновлен на "${getStatusText(status)}"`
        });
    });
});

// Обновление приоритета заявки
app.patch('/api/applications/:id/priority', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { priority } = req.body;
    const { username } = req.user;

    const allowedPriorities = ['normal', 'high', 'urgent'];
    if (!allowedPriorities.includes(priority)) {
        return res.status(400).json({ error: 'Неверный приоритет' });
    }

    const sql = `UPDATE applications SET priority = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ? AND username = ?`;
    
    db.run(sql, [priority, id, username], function(err) {
        if (err) {
            console.error('❌ Ошибка обновления приоритета:', err.message);
            return res.status(500).json({ error: 'Ошибка обновления приоритета' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'Заявка не найдена или у вас нет прав' });
        }

        res.json({
            success: true,
            message: `Приоритет заявки обновлен на "${getPriorityText(priority)}"`
        });
    });
});

// Получение всех заявок (для администратора)
app.get('/api/admin/applications', authenticateToken, requireAdmin, (req, res) => {
    const { status = 'all', priority = 'all' } = req.query;
    
    let sql = `SELECT * FROM applications WHERE 1=1`;
    const params = [];
    
    if (status && status !== 'all') {
        sql += ` AND status = ?`;
        params.push(status);
    }
    
    if (priority && priority !== 'all') {
        sql += ` AND priority = ?`;
        params.push(priority);
    }
    
    sql += ` ORDER BY 
        CASE priority 
            WHEN 'urgent' THEN 1
            WHEN 'high' THEN 2
            WHEN 'normal' THEN 3
            ELSE 4
        END,
        created_at DESC`;

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('❌ Ошибка получения заявок:', err.message);
            return res.status(500).json({ error: 'Ошибка получения заявок' });
        }

        const formattedRows = rows.map(row => ({
            ...row,
            created_at: formatDate(row.created_at),
            need_date: formatDate(row.need_date)
        }));

        res.json({
            success: true,
            applications: formattedRows,
            count: rows.length
        });
    });
});

// Получение всех заявок (для API с токеном)
app.get('/api/applications', authenticateApiToken, (req, res) => {
    const sql = `SELECT * FROM applications ORDER BY 
        CASE priority 
            WHEN 'urgent' THEN 1
            WHEN 'high' THEN 2
            WHEN 'normal' THEN 3
            ELSE 4
        END,
        created_at DESC`;
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('❌ Ошибка получения заявок:', err.message);
            return res.status(500).json({ error: 'Ошибка получения заявок' });
        }

        const formattedRows = rows.map(row => ({
            ...row,
            created_at: formatDate(row.created_at),
            need_date: formatDate(row.need_date)
        }));

        res.json({
            success: true,
            applications: formattedRows,
            count: rows.length
        });
    });
});

// Получение конкретной заявки
app.get('/api/applications/:id', authenticateApiToken, (req, res) => {
    const id = parseInt(req.params.id);
    
    if (isNaN(id) || id <= 0) {
        return res.status(400).json({ error: 'Неверный ID заявки' });
    }

    const sql = `SELECT * FROM applications WHERE id = ?`;
    
    db.get(sql, [id], (err, row) => {
        if (err) {
            console.error('❌ Ошибка получения заявки:', err.message);
            return res.status(500).json({ error: 'Ошибка получения заявки' });
        }

        if (!row) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }

        const formattedRow = {
            ...row,
            created_at: formatDate(row.created_at),
            need_date: formatDate(row.need_date)
        };

        res.json({
            success: true,
            application: formattedRow
        });
    });
});

// Вспомогательные функции
function getStatusText(status) {
    const statusMap = {
        'active': 'Активная',
        'completed': 'Выполнена',
        'cancelled': 'Отменена'
    };
    return statusMap[status] || status;
}

function getPriorityText(priority) {
    const priorityMap = {
        'normal': 'Обычный',
        'high': 'Высокий',
        'urgent': 'Срочный'
    };
    return priorityMap[priority] || priority;
}

function formatDate(dateString) {
    if (!dateString) return '';
    
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    } catch (error) {
        return dateString;
    }
}

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📝 LDAP URL: ${config.ldapUrl}`);
    console.log(`👑 Администраторы: ${config.adminUsernames.join(', ') || 'не настроены'}`);
    console.log(`🌐 Приложение доступно по адресу: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Завершение работы сервера...');
    db.close((err) => {
        if (err) {
            console.error('❌ Ошибка закрытия базы данных:', err.message);
        } else {
            console.log('✅ База данных закрыта');
        }
        process.exit(0);
    });
});