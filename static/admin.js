class AdminPanel {
    constructor() {
        this.token = '';
        this.user = '';
        this.username = '';
        this.isAdmin = false;
        this.applications = [];
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        document.getElementById('authForm').addEventListener('submit', (e) => this.handleAuth(e));
        document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());
        document.getElementById('refresh-admin-btn').addEventListener('click', () => this.loadAdminApplications());
        document.getElementById('apply-filters').addEventListener('click', () => this.applyFilters());
        
        // Enter для поиска
        document.getElementById('search-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.applyFilters();
            }
        });
    }

    // Универсальная функция форматирования дат
    formatDate(dateString) {
        if (!dateString) return '';
        
        try {
            let date;
            
            // Если дата уже в правильном формате (с точками)
            if (dateString.includes('.')) {
                return dateString;
            }
            // Если дата в формате SQLite "2025-11-13 09:04:42"
            else if (dateString.includes(' ')) {
                date = new Date(dateString.replace(' ', 'T') + 'Z');
            }
            // Если дата в формате "2025-11-13"
            else if (dateString.includes('-')) {
                date = new Date(dateString + 'T00:00:00Z');
            }
            // Другие форматы
            else {
                date = new Date(dateString);
            }
            
            if (isNaN(date.getTime())) {
                console.warn('Невалидная дата:', dateString);
                return dateString;
            }
            
            return date.toLocaleDateString('ru-RU', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
        } catch (error) {
            console.error('Ошибка форматирования даты:', error);
            return dateString;
        }
    }

    // Функция для получения только времени (часы:минуты)
    formatTime(dateString) {
        if (!dateString) return '';
        
        try {
            let date;
            
            // Если дата в формате SQLite "2025-11-13 09:04:42"
            if (dateString.includes(' ')) {
                date = new Date(dateString.replace(' ', 'T') + 'Z');
            }
            // Если дата в формате "2025-11-13"
            else if (dateString.includes('-')) {
                date = new Date(dateString + 'T00:00:00Z');
            }
            // Другие форматы
            else {
                date = new Date(dateString);
            }
            
            if (isNaN(date.getTime())) {
                console.warn('Невалидная дата:', dateString);
                return '';
            }
            
            return date.toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            console.error('Ошибка форматирования времени:', error);
            return '';
        }
    }

    async handleAuth(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!username || !password) {
            this.showError('auth-error', 'Заполните все поля');
            return;
        }

        this.setLoading('authForm', true);

        try {
            const response = await fetch('/api/auth', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                if (!data.isAdmin) {
                    this.showError('auth-error', 'У вас нет прав администратора');
                    return;
                }

                this.token = data.token;
                this.user = data.user;
                this.username = data.username;
                this.isAdmin = data.isAdmin;
                
                this.showAdminPanel();
                this.hideError('auth-error');
                this.loadAdminApplications();
                
            } else {
                this.showError('auth-error', data.error || 'Ошибка авторизации');
            }
        } catch (error) {
            this.showError('auth-error', 'Ошибка сети: ' + error.message);
        } finally {
            this.setLoading('authForm', false);
        }
    }

    async loadAdminApplications() {
        const statusFilter = document.getElementById('status-filter').value;
        const priorityFilter = document.getElementById('priority-filter').value;
        
        try {
            let url = `/api/admin/applications?status=${statusFilter}&priority=${priorityFilter}`;
            
            const response = await fetch(url, {
                headers: {
                    'Authorization': this.token
                }
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.applications = data.applications;
                this.displayAdminApplications(this.applications);
                this.updateAdminStats(this.applications);
                this.applySearchFilter();
            } else {
                this.showTempMessage('error', data.error || 'Ошибка загрузки заявок');
            }
        } catch (error) {
            this.showTempMessage('error', 'Ошибка сети при загрузке заявок');
        }
    }

    applyFilters() {
        this.loadAdminApplications();
    }

    applySearchFilter() {
        const searchInput = document.getElementById('search-input').value.toLowerCase().trim();
        
        if (!searchInput) {
            this.displayAdminApplications(this.applications);
            return;
        }

        const filteredApplications = this.applications.filter(app => 
            app.subject.toLowerCase().includes(searchInput) ||
            app.full_name.toLowerCase().includes(searchInput) ||
            app.username.toLowerCase().includes(searchInput)
        );

        this.displayAdminApplications(filteredApplications);
    }

    displayAdminApplications(applications) {
        const container = document.getElementById('admin-applications-list');
        const countElement = document.getElementById('applications-count');
        
        if (applications.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-5">
                    <i class="fas fa-clipboard-list fa-3x mb-3 opacity-50"></i>
                    <h6>Заявок не найдено</h6>
                    <p class="small">Попробуйте изменить фильтры или поисковый запрос</p>
                </div>
            `;
            countElement.textContent = '0 заявок';
            return;
        }

        container.innerHTML = applications.map(app => this.createAdminApplicationCard(app)).join('');
        countElement.textContent = `${applications.length} заявок`;
    }

    createAdminApplicationCard(application) {
        const statusText = this.getStatusText(application.status);
        const priorityText = this.getPriorityText(application.priority);
        
        // Форматируем дату и время создания
        const createdDate = this.formatDate(application.created_at);
        const createdTime = this.formatTime(application.created_at);
        const updatedDate = this.formatDate(application.updated_at);
        const updatedTime = this.formatTime(application.updated_at);
        
        let statusButtons = '';
        
        if (application.status === 'active') {
            statusButtons = `
                <div class="btn-group w-100">
                    <button class="btn btn-success btn-sm" onclick="adminPanel.updateAdminStatus(${application.id}, 'completed')">
                        <i class="fas fa-check"></i> Выполнено
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="adminPanel.updateAdminStatus(${application.id}, 'cancelled')">
                        <i class="fas fa-times"></i> Отмена
                    </button>
                </div>
            `;
        } else {
            statusButtons = `
                <button class="btn btn-primary btn-sm w-100" onclick="adminPanel.updateAdminStatus(${application.id}, 'active')">
                    <i class="fas fa-redo"></i> Вернуть в работу
                </button>
            `;
        }

        let priorityButtons = '';
        if (application.status === 'active') {
            priorityButtons = `
                <div class="btn-group w-100 mt-2">
                    <button class="btn btn-outline-danger btn-sm ${application.priority === 'urgent' ? 'active' : ''}" 
                            onclick="adminPanel.updateAdminPriority(${application.id}, 'urgent')">
                        <i class="fas fa-exclamation-triangle"></i> Срочно
                    </button>
                    <button class="btn btn-outline-warning btn-sm ${application.priority === 'high' ? 'active' : ''}" 
                            onclick="adminPanel.updateAdminPriority(${application.id}, 'high')">
                        <i class="fas fa-arrow-up"></i> Высокий
                    </button>
                    <button class="btn btn-outline-success btn-sm ${application.priority === 'normal' ? 'active' : ''}" 
                            onclick="adminPanel.updateAdminPriority(${application.id}, 'normal')">
                        <i class="fas fa-arrow-down"></i> Обычный
                    </button>
                </div>
            `;
        }

        return `
            <div class="card application-card ${application.status} ${application.priority} border-0 mb-3">
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-8">
                            <div class="d-flex justify-content-between align-items-start mb-2">
                                <h5 class="card-title text-primary">${application.subject}</h5>
                                <div class="text-end">
                                    <small class="text-muted">#${application.id}</small>
                                    <div>
                                        <span class="badge status-badge bg-status-${application.status} me-1">${statusText}</span>
                                        <span class="badge priority-badge bg-priority-${application.priority}">${priorityText}</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="row mb-2">
                                <div class="col-sm-6">
                                    <small class="text-muted">
                                        <i class="fas fa-user me-1"></i><strong>Автор:</strong> ${application.full_name}
                                    </small>
                                </div>
                                <div class="col-sm-6">
                                    <small class="text-muted">
                                        <i class="fas fa-at me-1"></i><strong>Логин:</strong> ${application.username}
                                    </small>
                                </div>
                            </div>
                            
                            <div class="row mb-2">
                                <div class="col-sm-4">
                                    <small class="text-muted">
                                        <i class="fas fa-calculator me-1"></i><strong>Количество:</strong> ${application.quantity}
                                    </small>
                                </div>
                                <div class="col-sm-4">
                                    <small class="text-muted">
                                        <i class="fas fa-calendar-alt me-1"></i><strong>Нужно к:</strong> ${application.need_date}
                                    </small>
                                </div>
                                <div class="col-sm-4">
                                    <small class="text-muted">
                                        <i class="fas fa-clock me-1"></i><strong>Создана:</strong> ${createdDate} в ${createdTime}
                                    </small>
                                </div>
                            </div>

                            <div class="row mb-2">
                                <div class="col-sm-6">
                                    <small class="text-muted">
                                        <i class="fas fa-sync-alt me-1"></i><strong>Обновлена:</strong> ${updatedDate} в ${updatedTime}
                                    </small>
                                </div>
                            </div>
                            
                            ${application.link ? `
                                <div class="mb-2">
                                    <small class="text-muted">
                                        <i class="fas fa-link me-1"></i><strong>Ссылка:</strong> 
                                        <a href="${application.link}" target="_blank" class="text-primary">${application.link}</a>
                                    </small>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div class="col-md-4">
                            <div class="border-start ps-3">
                                <h6 class="text-muted mb-2">Управление:</h6>
                                ${statusButtons}
                                ${priorityButtons}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    updateAdminStats(applications) {
        const adminStatTotal = document.getElementById('admin-stat-total');
        const adminStatActive = document.getElementById('admin-stat-active');
        const adminStatCompleted = document.getElementById('admin-stat-completed');
        const adminStatUrgent = document.getElementById('admin-stat-urgent');

        if (adminStatTotal && adminStatActive && adminStatCompleted && adminStatUrgent) {
            const totalCount = applications.length;
            const activeCount = applications.filter(app => app.status === 'active').length;
            const completedCount = applications.filter(app => app.status === 'completed').length;
            const urgentCount = applications.filter(app => app.priority === 'urgent').length;

            adminStatTotal.textContent = totalCount;
            adminStatActive.textContent = activeCount;
            adminStatCompleted.textContent = completedCount;
            adminStatUrgent.textContent = urgentCount;
        }
    }

    async updateAdminStatus(applicationId, status) {
        try {
            const response = await fetch(`/api/applications/${applicationId}/admin-status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.token
                },
                body: JSON.stringify({ status })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.showTempMessage('success', data.message);
                this.loadAdminApplications();
            } else {
                this.showTempMessage('error', data.error || 'Ошибка обновления статуса');
            }
        } catch (error) {
            this.showTempMessage('error', 'Ошибка сети: ' + error.message);
        }
    }

    async updateAdminPriority(applicationId, priority) {
        try {
            const response = await fetch(`/api/applications/${applicationId}/priority`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.token
                },
                body: JSON.stringify({ priority })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.showTempMessage('success', data.message);
                this.loadAdminApplications();
            } else {
                this.showTempMessage('error', data.error || 'Ошибка обновления приоритета');
            }
        } catch (error) {
            this.showTempMessage('error', 'Ошибка сети: ' + error.message);
        }
    }

    getStatusText(status) {
        const statusMap = {
            'active': 'Активная',
            'completed': 'Выполнена',
            'cancelled': 'Отменена'
        };
        return statusMap[status] || status;
    }

    getPriorityText(priority) {
        const priorityMap = {
            'normal': 'Обычный',
            'high': 'Высокий',
            'urgent': 'Срочный'
        };
        return priorityMap[priority] || priority;
    }

    showAdminPanel() {
        document.getElementById('auth-section').classList.add('d-none');
        document.getElementById('admin-panel').classList.remove('d-none');
        document.getElementById('admin-panel').classList.add('fade-in');
        
        const userName = document.getElementById('user-name');
        const userInfo = document.getElementById('user-info');

        if (userName) userName.textContent = this.user;
        if (userInfo) userInfo.classList.remove('d-none');
    }

    handleLogout() {
        this.token = '';
        this.user = '';
        this.username = '';
        this.isAdmin = false;
        
        document.getElementById('admin-panel').classList.add('d-none');
        document.getElementById('auth-section').classList.remove('d-none');
        
        const userInfo = document.getElementById('user-info');
        if (userInfo) userInfo.classList.add('d-none');
        
        document.getElementById('authForm').reset();
    }

    showError(elementId, message) {
        const element = document.getElementById(elementId);
        if (element) {
            element.innerHTML = `<i class="fas fa-exclamation-triangle me-2"></i>${message}`;
            element.classList.remove('d-none');
        }
    }

    showTempMessage(type, message) {
        const alertClass = type === 'success' ? 'alert-success' : 'alert-danger';
        const tempDiv = document.createElement('div');
        tempDiv.className = `alert ${alertClass} alert-dismissible fade show position-fixed`;
        tempDiv.style.cssText = 'top: 20px; right: 20px; z-index: 1050; min-width: 300px;';
        tempDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        document.body.appendChild(tempDiv);
        
        setTimeout(() => {
            if (tempDiv.parentNode) {
                tempDiv.parentNode.removeChild(tempDiv);
            }
        }, 5000);
    }

    setLoading(formId, isLoading) {
        const form = document.getElementById(formId);
        if (!form) return;
        
        const button = form.querySelector('button[type="submit"]');
        if (!button) return;
        
        if (isLoading) {
            form.classList.add('loading');
            button.disabled = true;
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Проверка прав...';
            button.setAttribute('data-original-text', originalText);
        } else {
            form.classList.remove('loading');
            button.disabled = false;
            const originalText = button.getAttribute('data-original-text');
            if (originalText) {
                button.innerHTML = originalText;
            }
        }
    }
}

// Инициализация панели администратора
let adminPanel;
document.addEventListener('DOMContentLoaded', () => {
    adminPanel = new AdminPanel();
    
    const firstInput = document.getElementById('username');
    if (firstInput) {
        setTimeout(() => firstInput.focus(), 500);
    }
});