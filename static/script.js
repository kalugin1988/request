class ApplicationSystem {
    constructor() {
        this.token = '';
        this.user = '';
        this.username = '';
        this.isAdmin = false;
        
        this.initializeEventListeners();
        this.setMinDate();
    }

    initializeEventListeners() {
        document.getElementById('authForm').addEventListener('submit', (e) => this.handleAuth(e));
        document.getElementById('appForm').addEventListener('submit', (e) => this.handleApplication(e));
        document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());
        document.getElementById('refresh-apps').addEventListener('click', () => this.loadApplications());
        document.getElementById('status-filter').addEventListener('change', () => this.loadApplications());
        document.getElementById('priority-filter').addEventListener('change', () => this.loadApplications());
        
        const adminPanelBtn = document.getElementById('admin-panel-btn');
        const refreshAdminBtn = document.getElementById('refresh-admin-apps');
        
        if (adminPanelBtn) {
            adminPanelBtn.addEventListener('click', () => this.toggleAdminPanel());
        }
        if (refreshAdminBtn) {
            refreshAdminBtn.addEventListener('click', () => this.loadAdminApplications());
        }
    }

    setMinDate() {
        const today = new Date().toISOString().split('T')[0];
        const needDateInput = document.getElementById('needDate');
        if (needDateInput) {
            needDateInput.min = today;
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            needDateInput.value = tomorrow.toISOString().split('T')[0];
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
                this.token = data.token;
                this.user = data.user;
                this.username = data.username;
                this.isAdmin = data.isAdmin;
                this.showMainSection();
                this.hideError('auth-error');
                this.loadApplications();
                
                if (this.isAdmin) {
                    this.loadAdminApplications();
                }
            } else {
                this.showError('auth-error', data.error || 'Ошибка авторизации');
            }
        } catch (error) {
            this.showError('auth-error', 'Ошибка сети: ' + error.message);
        } finally {
            this.setLoading('authForm', false);
        }
    }

    async handleApplication(e) {
        e.preventDefault();
        
        const subject = document.getElementById('subject').value.trim();
        const quantity = parseInt(document.getElementById('quantity').value);
        const needDate = document.getElementById('needDate').value;
        const link = document.getElementById('link').value.trim();

        if (!subject) {
            this.showError('app-error', 'Введите название предмета');
            return;
        }

        if (quantity < 1) {
            this.showError('app-error', 'Количество должно быть не менее 1');
            return;
        }

        if (!needDate) {
            this.showError('app-error', 'Выберите требуемую дату');
            return;
        }

        const applicationData = {
            subject,
            quantity,
            need_date: needDate,
            link: link || ''
        };

        this.setLoading('appForm', true);

        try {
            const response = await fetch('/api/applications', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.token
                },
                body: JSON.stringify(applicationData)
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.showSuccess('app-success', `✅ Заявка #${data.id} успешно создана!`);
                document.getElementById('appForm').reset();
                this.setMinDate();
                this.hideError('app-error');
                this.loadApplications();
                
                if (this.isAdmin) {
                    this.loadAdminApplications();
                }
                
                setTimeout(() => {
                    this.hideSuccess('app-success');
                }, 5000);
            } else {
                this.showError('app-error', data.error || 'Ошибка создания заявки');
            }
        } catch (error) {
            this.showError('app-error', 'Ошибка сети: ' + error.message);
        } finally {
            this.setLoading('appForm', false);
        }
    }

    async loadApplications() {
        const statusFilter = document.getElementById('status-filter').value;
        const priorityFilter = document.getElementById('priority-filter').value;
        
        try {
            const response = await fetch(`/api/my-applications?status=${statusFilter}&priority=${priorityFilter}`, {
                headers: {
                    'Authorization': this.token
                }
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.displayApplications(data.applications);
                this.updateStats(data.applications);
            } else {
                console.error('Ошибка загрузки заявок:', data.error);
            }
        } catch (error) {
            console.error('Ошибка сети при загрузке заявок:', error);
        }
    }

    async loadAdminApplications() {
        try {
            const response = await fetch('/api/admin/applications', {
                headers: {
                    'Authorization': this.token
                }
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.displayAdminApplications(data.applications);
                this.updateAdminStats(data.applications);
            } else {
                console.error('Ошибка загрузки заявок администратора:', data.error);
            }
        } catch (error) {
            console.error('Ошибка сети при загрузке заявок администратора:', error);
        }
    }

    displayApplications(applications) {
        const container = document.getElementById('applications-list');
        
        if (applications.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-5">
                    <i class="fas fa-clipboard-list fa-3x mb-3 opacity-50"></i>
                    <h6>Заявок не найдено</h6>
                    <p class="small">Попробуйте изменить фильтры</p>
                </div>
            `;
            return;
        }

        container.innerHTML = applications.map(app => this.createApplicationCard(app)).join('');
    }

    displayAdminApplications(applications) {
        const container = document.getElementById('admin-applications-list');
        
        if (applications.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-5">
                    <i class="fas fa-clipboard-list fa-3x mb-3 opacity-50"></i>
                    <h6>Заявок не найдено</h6>
                </div>
            `;
            return;
        }

        container.innerHTML = applications.map(app => this.createAdminApplicationCard(app)).join('');
    }

    createApplicationCard(application) {
        const statusText = this.getStatusText(application.status);
        const priorityText = this.getPriorityText(application.priority);
        const createdDate = new Date(application.created_at).toLocaleDateString('ru-RU');
        
        let actionButtons = '';
        
        if (application.status === 'active') {
            actionButtons = `
                <div class="btn-group w-100">
                    <button class="btn btn-outline-warning btn-sm" onclick="appSystem.updatePriority(${application.id}, 'urgent')">
                        <i class="fas fa-exclamation-triangle"></i> Срочно!
                    </button>
                    <button class="btn btn-outline-info btn-sm" onclick="appSystem.updatePriority(${application.id}, 'high')">
                        <i class="fas fa-arrow-up"></i> Высокий
                    </button>
                    <button class="btn btn-outline-secondary btn-sm" onclick="appSystem.updatePriority(${application.id}, 'normal')">
                        <i class="fas fa-arrow-down"></i> Обычный
                    </button>
                    <button class="btn btn-outline-danger btn-sm" onclick="appSystem.updateStatus(${application.id}, 'cancelled')">
                        <i class="fas fa-times"></i> Отмена
                    </button>
                </div>
            `;
        } else if (application.status === 'cancelled') {
            actionButtons = `
                <button class="btn btn-outline-primary btn-sm w-100" onclick="appSystem.updateStatus(${application.id}, 'active')">
                    <i class="fas fa-redo"></i> Вернуть в работу
                </button>
            `;
        }

        return `
            <div class="card application-card ${application.status} ${application.priority} fade-in mb-3">
                <div class="card-body p-3">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <h6 class="card-title mb-0">${application.subject}</h6>
                        <small class="text-muted">#${application.id}</small>
                    </div>
                    
                    <div class="mb-2">
                        <span class="badge status-badge bg-status-${application.status} me-1">${statusText}</span>
                        <span class="badge priority-badge bg-priority-${application.priority}">${priorityText}</span>
                    </div>
                    
                    <div class="small text-muted mb-2">
                        <div>Количество: ${application.quantity}</div>
                        <div>Нужно к: ${application.need_date}</div>
                        <div>Создана: ${createdDate}</div>
                        ${application.link ? `<div><a href="${application.link}" target="_blank" class="text-primary">Ссылка на товар</a></div>` : ''}
                    </div>
                    
                    ${actionButtons}
                </div>
            </div>
        `;
    }

    createAdminApplicationCard(application) {
        const statusText = this.getStatusText(application.status);
        const priorityText = this.getPriorityText(application.priority);
        const createdDate = new Date(application.created_at).toLocaleDateString('ru-RU');
        
        let actionButtons = '';
        
        if (application.status === 'active') {
            actionButtons = `
                <div class="btn-group w-100">
                    <button class="btn btn-outline-success btn-sm" onclick="appSystem.updateAdminStatus(${application.id}, 'completed')">
                        <i class="fas fa-check"></i> Выполнено
                    </button>
                    <button class="btn btn-outline-danger btn-sm" onclick="appSystem.updateAdminStatus(${application.id}, 'cancelled')">
                        <i class="fas fa-times"></i> Отмена
                    </button>
                </div>
            `;
        } else {
            actionButtons = `
                <button class="btn btn-outline-primary btn-sm w-100" onclick="appSystem.updateAdminStatus(${application.id}, 'active')">
                    <i class="fas fa-redo"></i> Вернуть в работу
                </button>
            `;
        }

        return `
            <div class="card application-card ${application.status} ${application.priority} fade-in mb-3">
                <div class="card-body p-3">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <h6 class="card-title mb-0">${application.subject}</h6>
                        <small class="text-muted">#${application.id}</small>
                    </div>
                    
                    <div class="mb-2">
                        <span class="badge status-badge bg-status-${application.status} me-1">${statusText}</span>
                        <span class="badge priority-badge bg-priority-${application.priority}">${priorityText}</span>
                        <span class="badge bg-secondary">${application.username}</span>
                    </div>
                    
                    <div class="small text-muted mb-2">
                        <div><strong>Автор:</strong> ${application.full_name}</div>
                        <div>Количество: ${application.quantity}</div>
                        <div>Нужно к: ${application.need_date}</div>
                        <div>Создана: ${createdDate}</div>
                        ${application.link ? `<div><a href="${application.link}" target="_blank" class="text-primary">Ссылка на товар</a></div>` : ''}
                    </div>
                    
                    ${actionButtons}
                </div>
            </div>
        `;
    }

    updateStats(applications) {
        const statsSection = document.getElementById('stats-section');
        const statActive = document.getElementById('stat-active');
        const statCompleted = document.getElementById('stat-completed');
        const statTotal = document.getElementById('stat-total');

        if (statsSection && statActive && statCompleted && statTotal) {
            const activeCount = applications.filter(app => app.status === 'active').length;
            const completedCount = applications.filter(app => app.status === 'completed').length;
            const totalCount = applications.length;

            statActive.textContent = activeCount;
            statCompleted.textContent = completedCount;
            statTotal.textContent = totalCount;

            statsSection.style.display = 'flex';
        }
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

    async updateStatus(applicationId, status) {
        try {
            const response = await fetch(`/api/applications/${applicationId}/status`, {
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
                this.loadApplications();
            } else {
                this.showTempMessage('error', data.error || 'Ошибка обновления статуса');
            }
        } catch (error) {
            this.showTempMessage('error', 'Ошибка сети: ' + error.message);
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
                this.loadApplications();
                this.loadAdminApplications();
            } else {
                this.showTempMessage('error', data.error || 'Ошибка обновления статуса');
            }
        } catch (error) {
            this.showTempMessage('error', 'Ошибка сети: ' + error.message);
        }
    }

    async updatePriority(applicationId, priority) {
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
                this.loadApplications();
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

    showMainSection() {
        document.getElementById('auth-section').classList.add('d-none');
        document.getElementById('main-section').classList.remove('d-none');
        document.getElementById('main-section').classList.add('fade-in');
        
        const userName = document.getElementById('user-name');
        const mainUserName = document.getElementById('main-user-name');
        const userRole = document.getElementById('user-role');
        const userWelcomeText = document.getElementById('user-welcome-text');
        const userInfo = document.getElementById('user-info');
        const adminPanelBtn = document.getElementById('admin-panel-btn');

        if (userName) userName.textContent = this.user;
        if (mainUserName) mainUserName.textContent = this.user;
        if (userRole) userRole.textContent = this.isAdmin ? 'Администратор' : 'Пользователь';
        if (userWelcomeText) {
            userWelcomeText.textContent = this.isAdmin 
                ? 'Управляйте всеми заявками системы' 
                : 'Управляйте вашими заявками на учебные материалы';
        }
        if (userInfo) userInfo.classList.remove('d-none');
        if (adminPanelBtn && this.isAdmin) adminPanelBtn.classList.remove('d-none');
    }

    toggleAdminPanel() {
        const panel = document.getElementById('admin-panel-section');
        const button = document.getElementById('admin-panel-btn');
        
        if (panel.classList.contains('d-none')) {
            panel.classList.remove('d-none');
            button.classList.add('btn-warning');
            button.classList.remove('btn-outline-warning');
            this.loadAdminApplications();
        } else {
            panel.classList.add('d-none');
            button.classList.remove('btn-warning');
            button.classList.add('btn-outline-warning');
        }
    }

    handleLogout() {
        this.token = '';
        this.user = '';
        this.username = '';
        this.isAdmin = false;
        
        document.getElementById('main-section').classList.add('d-none');
        document.getElementById('auth-section').classList.remove('d-none');
        document.getElementById('admin-panel-section').classList.add('d-none');
        
        const adminPanelBtn = document.getElementById('admin-panel-btn');
        const userInfo = document.getElementById('user-info');
        
        if (adminPanelBtn) adminPanelBtn.classList.add('d-none');
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

    showSuccess(elementId, message) {
        const element = document.getElementById(elementId);
        if (element) {
            element.innerHTML = message;
            element.classList.remove('d-none');
        }
    }

    hideError(elementId) {
        const element = document.getElementById(elementId);
        if (element) element.classList.add('d-none');
    }

    hideSuccess(elementId) {
        const element = document.getElementById(elementId);
        if (element) element.classList.add('d-none');
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
            button.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Обработка...';
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

// Инициализация приложения после загрузки DOM
let appSystem;
document.addEventListener('DOMContentLoaded', () => {
    appSystem = new ApplicationSystem();
    
    const firstInput = document.getElementById('username');
    if (firstInput) {
        setTimeout(() => firstInput.focus(), 500);
    }
});