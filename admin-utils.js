const fs = require('fs');
const path = require('path');

class AdminUtils {
    constructor() {
        this.envPath = path.join(__dirname, '.env');
    }

    // Чтение текущих администраторов
    getCurrentAdmins() {
        try {
            const envContent = fs.readFileSync(this.envPath, 'utf8');
            const adminLine = envContent.split('\n').find(line => line.startsWith('ADMIN_USERNAMES='));
            
            if (!adminLine) {
                return [];
            }

            const adminsString = adminLine.split('=')[1];
            return adminsString
                .split(',')
                .map(u => u.trim())
                .filter(u => u);
        } catch (error) {
            console.error('❌ Ошибка чтения .env файла:', error.message);
            return [];
        }
    }

    // Добавление администратора
    addAdmin(username) {
        try {
            const currentAdmins = this.getCurrentAdmins();
            
            if (currentAdmins.includes(username)) {
                return { success: false, message: 'Пользователь уже является администратором' };
            }

            currentAdmins.push(username);
            this.updateEnvFile(currentAdmins);
            
            return { 
                success: true, 
                message: `Пользователь ${username} добавлен в администраторы`,
                currentAdmins: currentAdmins 
            };
        } catch (error) {
            return { success: false, message: 'Ошибка добавления администратора' };
        }
    }

    // Удаление администратора
    removeAdmin(username) {
        try {
            const currentAdmins = this.getCurrentAdmins();
            const filteredAdmins = currentAdmins.filter(admin => admin !== username);
            
            if (filteredAdmins.length === currentAdmins.length) {
                return { success: false, message: 'Пользователь не найден среди администраторов' };
            }

            this.updateEnvFile(filteredAdmins);
            
            return { 
                success: true, 
                message: `Пользователь ${username} удален из администраторов`,
                currentAdmins: filteredAdmins 
            };
        } catch (error) {
            return { success: false, message: 'Ошибка удаления администратора' };
        }
    }

    // Обновление .env файла
    updateEnvFile(admins) {
        try {
            let envContent = fs.readFileSync(this.envPath, 'utf8');
            const lines = envContent.split('\n');
            
            const newLines = lines.map(line => {
                if (line.startsWith('ADMIN_USERNAMES=')) {
                    return `ADMIN_USERNAMES=${admins.join(',')}`;
                }
                return line;
            });

            // Если строки с ADMIN_USERNAMES не было, добавляем её
            if (!lines.some(line => line.startsWith('ADMIN_USERNAMES='))) {
                newLines.push(`ADMIN_USERNAMES=${admins.join(',')}`);
            }

            fs.writeFileSync(this.envPath, newLines.join('\n'));
            console.log('✅ .env файл обновлен с администраторами:', admins.join(', '));
        } catch (error) {
            console.error('❌ Ошибка обновления .env файла:', error.message);
            throw error;
        }
    }

    // Получение списка всех пользователей (для админки)
    async getAllUsers() {
        // Здесь можно добавить логику для получения списка всех пользователей из LDAP
        // Пока возвращаем заглушку
        return [
            { username: 'kalugin.o', fullName: 'Калугин Олег' },
            { username: 'vorobeva', fullName: 'Воробьева Мария' },
            { username: 'ivanov', fullName: 'Иванов Иван' }
        ];
    }
}

module.exports = AdminUtils;