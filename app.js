require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const AdminUtils = require('./admin-utils.js');

const app = express();
const PORT = process.env.PORT || 8080;

// Конфигурация
const config = {
    ldapUrl: process.env.LDAP_URL || 'https://ldap.itschool25.ru/api/auth',
    apiToken: process.env.API_TOKEN || 'default_api_token_change_me',
    jwtSecret: process.env.JWT_SECRET || 'your_jwt_secret_key_change_in_production',
    adminUsernames: (process.env.ADMIN_USERNAMES || '').split(',').map(u => u.trim().toLowerCase()).filter(u => u)
};

// Инициализация утилит администратора
const adminUtils = new AdminUtils();

// Создаем папку data если её нет
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('✅ Папка data создана');
}

// Report Generator
class ReportGenerator {
    constructor(db) {
        this.db = db;
    }

    // Полный отчет
    async generateFullReport() {
        return new Promise((resolve, reject) => {
            const report = {
                timestamp: new Date().toISOString(),
                summary: {},
                users: [],
                pendingItems: [],
                weeklyStats: []
            };

            // Сводная статистика
            const summaryQueries = [
                `SELECT COUNT(*) as total FROM applications`,
                `SELECT COUNT(*) as active FROM applications WHERE status = 'active'`,
                `SELECT COUNT(*) as completed FROM applications WHERE status = 'completed'`,
                `SELECT COUNT(*) as cancelled FROM applications WHERE status = 'cancelled'`,
                `SELECT COUNT(*) as urgent FROM applications WHERE priority = 'urgent'`,
                `SELECT COUNT(*) as high FROM applications WHERE priority = 'high'`,
                `SELECT COUNT(*) as normal FROM applications WHERE priority = 'normal'`
            ];

            Promise.all(summaryQueries.map(query => this.runQuery(query)))
                .then(results => {
                    report.summary = {
                        total: results[0][0].total,
                        active: results[1][0].active,
                        completed: results[2][0].completed,
                        cancelled: results[3][0].cancelled,
                        urgent: results[4][0].urgent,
                        high: results[5][0].high,
                        normal: results[6][0].normal
                    };

                    // Статистика по пользователям
                    return this.runQuery(`
                        SELECT 
                            username,
                            full_name,
                            COUNT(*) as total_applications,
                            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
                            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
                            MAX(created_at) as last_activity
                        FROM applications 
                        GROUP BY username, full_name
                        ORDER BY total_applications DESC
                    `);
                })
                .then(users => {
                    report.users = users;

                    // Товары в потребности
                    return this.runQuery(`
                        SELECT 
                            subject,
                            SUM(quantity) as total_quantity,
                            COUNT(*) as total_requests,
                            SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent_requests,
                            SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_requests,
                            MIN(need_date) as earliest_need_date,
                            MAX(need_date) as latest_need_date,
                            GROUP_CONCAT(DISTINCT full_name) as requester_names
                        FROM applications 
                        WHERE status = 'active'
                        GROUP BY subject
                        ORDER BY total_quantity DESC
                    `);
                })
                .then(items => {
                    report.pendingItems = items;

                    // Недельная статистика
                    return this.runQuery(`
                        SELECT 
                            DATE(created_at) as date,
                            COUNT(*) as applications_count,
                            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
                        FROM applications 
                        WHERE created_at >= date('now', '-7 days')
                        GROUP BY DATE(created_at)
                        ORDER BY date ASC
                    `);
                })
                .then(weeklyStats => {
                    report.weeklyStats = weeklyStats;
                    resolve(report);
                })
                .catch(reject);
        });
    }

    // Отчет по статусам
    async getStatusReport() {
        return this.runQuery(`
            SELECT 
                status,
                COUNT(*) as count,
                ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM applications), 2) as percentage
            FROM applications 
            GROUP BY status
            ORDER BY count DESC
        `);
    }

    // Отчет по приоритетам
    async getPriorityReport() {
        return this.runQuery(`
            SELECT 
                priority,
                COUNT(*) as count,
                ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM applications), 2) as percentage
            FROM applications 
            GROUP BY priority
            ORDER BY 
                CASE priority 
                    WHEN 'urgent' THEN 1
                    WHEN 'high' THEN 2
                    WHEN 'normal' THEN 3
                    ELSE 4
                END
        `);
    }

    // Отчет по пользователям
    async getUserReport() {
        return this.runQuery(`
            SELECT 
                username,
                full_name,
                COUNT(*) as total_applications,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
                MAX(created_at) as last_activity
            FROM applications 
            GROUP BY username, full_name
            ORDER BY total_applications DESC
        `);
    }

    // Отчет по товарам в потребности
    async getPendingItemsReport() {
        return this.runQuery(`
            SELECT 
                subject,
                SUM(quantity) as total_quantity,
                COUNT(*) as total_requests,
                SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent_requests,
                SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_requests,
                MIN(need_date) as earliest_need_date,
                MAX(need_date) as latest_need_date,
                GROUP_CONCAT(DISTINCT full_name) as requester_names
            FROM applications 
            WHERE status = 'active'
            GROUP BY subject
            ORDER BY total_quantity DESC, urgent_requests DESC
        `);
    }

    // Еженедельный отчет
    async getWeeklyReport() {
        return this.runQuery(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as applications_count,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent,
                SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high
            FROM applications 
            WHERE created_at >= date('now', '-7 days')
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `);
    }

    // Вспомогательный метод для выполнения запросов
    runQuery(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
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

// Инициализация генератора отчетов
const reportGenerator = new ReportGenerator(db);

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

// Report page
app.get('/report', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'report.html'));
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

        // Проверяем, является ли пользователь администратором (не регистрозависимо)
        const normalizedUsername = username.toLowerCase();
        const isAdmin = config.adminUsernames.includes(normalizedUsername);

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
    // Приводим username к нижнему регистру для сравнения
    const userUsername = req.user.username.toLowerCase();
    const isAdmin = config.adminUsernames.includes(userUsername);
    
    if (!isAdmin) {
        return res.status(403).json({ error: 'Требуются права администратора' });
    }
    next();
}

// API для управления администраторами
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await adminUtils.getAllUsers();
        res.json({
            success: true,
            users: users
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения списка пользователей' });
    }
});

app.post('/api/admin/users/:username', authenticateToken, requireAdmin, (req, res) => {
    try {
        const { username } = req.params;
        const result = adminUtils.addAdmin(username);
        
        if (result.success) {
            // Обновляем конфигурацию после изменения списка администраторов
            config.adminUsernames = adminUtils.getCurrentAdmins();
        }
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка добавления администратора' });
    }
});

app.delete('/api/admin/users/:username', authenticateToken, requireAdmin, (req, res) => {
    try {
        const { username } = req.params;
        const result = adminUtils.removeAdmin(username);
        
        if (result.success) {
            // Обновляем конфигурацию после изменения списка администраторов
            config.adminUsernames = adminUtils.getCurrentAdmins();
        }
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка удаления администратора' });
    }
});

// Создание заявки
app.post('/api/applications', authenticateToken, (req, res) => {
    const { subject, quantity, need_date, link, priority = 'normal' } = req.body;
    const { username, fullName } = req.user;

    console.log('📅 Получена дата от пользователя:', need_date);

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
            // need_date оставляем как есть, так как это поле ввода пользователя
        }));

        console.log(`📋 Загружено ${formattedRows.length} заявок для пользователя ${username}`);
        
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
            // need_date оставляем как есть
        }));

        console.log(`📋 Администратор загрузил ${formattedRows.length} заявок`);
        
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
            // need_date оставляем как есть
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
            // need_date оставляем как есть
        };

        res.json({
            success: true,
            application: formattedRow
        });
    });
});

// Отчеты
app.get('/api/reports/full', authenticateApiToken, async (req, res) => {
    try {
        const report = await reportGenerator.generateFullReport();
        res.json({
            success: true,
            report: report
        });
    } catch (error) {
        console.error('❌ Ошибка генерации отчета:', error.message);
        res.status(500).json({ error: 'Ошибка генерации отчета' });
    }
});

app.get('/api/reports/status', authenticateApiToken, async (req, res) => {
    try {
        const report = await reportGenerator.getStatusReport();
        res.json({
            success: true,
            report: report
        });
    } catch (error) {
        console.error('❌ Ошибка генерации отчета по статусам:', error.message);
        res.status(500).json({ error: 'Ошибка генерации отчета по статусам' });
    }
});

app.get('/api/reports/priority', authenticateApiToken, async (req, res) => {
    try {
        const report = await reportGenerator.getPriorityReport();
        res.json({
            success: true,
            report: report
        });
    } catch (error) {
        console.error('❌ Ошибка генерации отчета по приоритетам:', error.message);
        res.status(500).json({ error: 'Ошибка генерации отчета по приоритетам' });
    }
});

app.get('/api/reports/users', authenticateApiToken, async (req, res) => {
    try {
        const report = await reportGenerator.getUserReport();
        res.json({
            success: true,
            report: report
        });
    } catch (error) {
        console.error('❌ Ошибка генерации отчета по пользователям:', error.message);
        res.status(500).json({ error: 'Ошибка генерации отчета по пользователям' });
    }
});

app.get('/api/reports/pending-items', authenticateApiToken, async (req, res) => {
    try {
        const report = await reportGenerator.getPendingItemsReport();
        res.json({
            success: true,
            report: report
        });
    } catch (error) {
        console.error('❌ Ошибка генерации отчета по товарам:', error.message);
        res.status(500).json({ error: 'Ошибка генерации отчета по товарам' });
    }
});

app.get('/api/reports/weekly', authenticateApiToken, async (req, res) => {
    try {
        const report = await reportGenerator.getWeeklyReport();
        res.json({
            success: true,
            report: report
        });
    } catch (error) {
        console.error('❌ Ошибка генерации еженедельного отчета:', error.message);
        res.status(500).json({ error: 'Ошибка генерации еженедельного отчета' });
    }
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
    if (!dateString) {
        console.log('❌ Пустая дата:', dateString);
        return '';
    }
    
    console.log('🔍 Форматируем дату:', dateString, 'Тип:', typeof dateString);
    
    try {
        let date;
        
        // Если дата в формате SQLite (YYYY-MM-DD HH:MM:SS)
        if (typeof dateString === 'string' && dateString.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
            console.log('📅 Обнаружен SQLite формат');
            // Заменяем пробел на 'T' и добавляем часовой пояс
            date = new Date(dateString.replace(' ', 'T') + 'Z');
        } 
        // Если дата в формате YYYY-MM-DD
        else if (typeof dateString === 'string' && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
            console.log('📅 Обнаружен формат YYYY-MM-DD');
            date = new Date(dateString + 'T00:00:00Z');
        }
        // Если это уже объект Date или timestamp
        else {
            console.log('📅 Другой формат даты');
            date = new Date(dateString);
        }
        
        console.log('📅 Результат парсинга:', date);
        console.log('📅 isValid:', !isNaN(date.getTime()));
        
        // Проверяем, что дата валидна
        if (isNaN(date.getTime())) {
            console.warn('⚠️  Невалидная дата после парсинга:', dateString);
            return dateString; // Возвращаем оригинальную строку
        }
        
        const formatted = date.toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        
        console.log('✅ Отформатированная дата:', formatted);
        return formatted;
        
    } catch (error) {
        console.error('❌ Ошибка форматирования даты:', dateString, error);
        return dateString;
    }
}

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📝 LDAP URL: ${config.ldapUrl}`);
    
    // Детальная информация об администраторах
    if (config.adminUsernames.length > 0) {
        console.log(`👑 Найдено администраторов: ${config.adminUsernames.length}`);
        console.log(`👥 Логины администраторов: ${config.adminUsernames.join(', ')}`);
    } else {
        console.log(`⚠️  Администраторы: не настроены (установите ADMIN_USERNAMES в .env)`);
    }
    
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