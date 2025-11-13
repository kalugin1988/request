class ReportViewer {
    constructor() {
        this.apiToken = this.getApiToken();
        this.init();
    }

    getApiToken() {
        // Токен можно передать через URL параметр или хранить в localStorage
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('token') || localStorage.getItem('apiToken') || prompt('Введите API токен:');
    }

    async init() {
        if (!this.apiToken) {
            alert('API токен не указан');
            return;
        }

        // Сохраняем токен для будущих запросов
        localStorage.setItem('apiToken', this.apiToken);
        
        this.showLoading(true);
        await this.loadFullReport();
        this.showLoading(false);
    }

    showLoading(show) {
        document.getElementById('loadingSpinner').style.display = show ? 'block' : 'none';
    }

    async loadFullReport() {
        try {
            const response = await fetch('/api/reports/full', {
                headers: {
                    'Authorization': this.apiToken
                }
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.renderReport(data.report);
            } else {
                throw new Error(data.error || 'Ошибка загрузки отчета');
            }
        } catch (error) {
            console.error('Ошибка загрузки отчета:', error);
            alert('Ошибка загрузки отчета: ' + error.message);
        }
    }

    renderReport(report) {
        this.updateReportMeta(report.timestamp);
        this.renderSummaryStats(report.summary);
        this.renderCharts(report);
        this.renderUsersTable(report.users);
        this.renderItemsTable(report.pendingItems);
    }

    updateReportMeta(timestamp) {
        const metaElement = document.getElementById('report-meta');
        const date = new Date(timestamp).toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        metaElement.innerHTML = `
            <div class="fw-bold">Отчет сформирован:</div>
            <div>${date}</div>
        `;
    }

    renderSummaryStats(summary) {
        const container = document.getElementById('summary-stats');
        
        const stats = [
            {
                title: 'Всего заявок',
                value: summary.total,
                icon: 'fas fa-clipboard-list',
                color: 'primary',
                bg: 'bg-primary text-white'
            },
            {
                title: 'Активные',
                value: summary.active,
                icon: 'fas fa-play-circle',
                color: 'success',
                bg: 'bg-success text-white'
            },
            {
                title: 'Выполненные',
                value: summary.completed,
                icon: 'fas fa-check-circle',
                color: 'info',
                bg: 'bg-info text-white'
            },
            {
                title: 'Отмененные',
                value: summary.cancelled,
                icon: 'fas fa-times-circle',
                color: 'secondary',
                bg: 'bg-secondary text-white'
            },
            {
                title: 'Срочные',
                value: summary.urgent,
                icon: 'fas fa-exclamation-triangle',
                color: 'danger',
                bg: 'bg-danger text-white'
            },
            {
                title: 'Высокий приоритет',
                value: summary.high,
                icon: 'fas fa-arrow-up',
                color: 'warning',
                bg: 'bg-warning text-dark'
            }
        ];

        container.innerHTML = stats.map(stat => `
            <div class="col-md-4 col-lg-2 mb-3">
                <div class="stat-card ${stat.bg} text-center">
                    <i class="${stat.icon} fa-2x mb-2"></i>
                    <h3 class="fw-bold">${stat.value}</h3>
                    <p class="mb-0 fw-semibold">${stat.title}</p>
                </div>
            </div>
        `).join('');
    }

    renderCharts(report) {
        this.renderStatusChart(report.summary);
        this.renderPriorityChart(report.summary);
        this.renderWeeklyChart();
    }

    renderStatusChart(summary) {
        const ctx = document.getElementById('statusChart').getContext('2d');
        
        new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Активные', 'Выполненные', 'Отмененные'],
                datasets: [{
                    data: [summary.active, summary.completed, summary.cancelled],
                    backgroundColor: [
                        '#28a745',
                        '#17a2b8',
                        '#6c757d'
                    ],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 20,
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = Math.round((context.raw / total) * 100);
                                return `${context.label}: ${context.raw} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    renderPriorityChart(summary) {
        const ctx = document.getElementById('priorityChart').getContext('2d');
        
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Срочные', 'Высокий', 'Обычный'],
                datasets: [{
                    label: 'Количество заявок',
                    data: [summary.urgent, summary.high, summary.normal],
                    backgroundColor: [
                        '#dc3545',
                        '#ffc107',
                        '#28a745'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }

    async renderWeeklyChart() {
        try {
            const response = await fetch('/api/reports/weekly', {
                headers: {
                    'Authorization': this.apiToken
                }
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.createWeeklyChart(data.report.weeklyStats);
            }
        } catch (error) {
            console.error('Ошибка загрузки недельной статистики:', error);
        }
    }

    createWeeklyChart(weeklyStats) {
        const ctx = document.getElementById('weeklyChart').getContext('2d');
        
        const labels = weeklyStats.map(stat => {
            const date = new Date(stat.date);
            return date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' });
        }).reverse();

        const applicationsData = weeklyStats.map(stat => stat.applications_count).reverse();
        const completedData = weeklyStats.map(stat => stat.completed).reverse();

        new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Создано заявок',
                        data: applicationsData,
                        borderColor: '#2c5aa0',
                        backgroundColor: 'rgba(44, 90, 160, 0.1)',
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: 'Выполнено заявок',
                        data: completedData,
                        borderColor: '#28a745',
                        backgroundColor: 'rgba(40, 167, 69, 0.1)',
                        tension: 0.4,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                },
                plugins: {
                    legend: {
                        position: 'top'
                    }
                }
            }
        });
    }

    renderUsersTable(users) {
        const tbody = document.getElementById('users-table-body');
        
        tbody.innerHTML = users.map(user => `
            <tr>
                <td>
                    <div class="fw-semibold">${user.full_name}</div>
                    <small class="text-muted">@${user.username}</small>
                </td>
                <td class="text-center">
                    <span class="badge bg-primary fs-6">${user.total_applications}</span>
                </td>
                <td class="text-center">
                    <span class="badge bg-success">${user.active}</span>
                </td>
                <td class="text-center">
                    <span class="badge bg-info">${user.completed}</span>
                </td>
                <td class="text-center">
                    <span class="badge bg-secondary">${user.cancelled}</span>
                </td>
                <td>
                    ${new Date(user.last_activity).toLocaleDateString('ru-RU')}
                </td>
            </tr>
        `).join('');
    }

    renderItemsTable(items) {
        const tbody = document.getElementById('items-table-body');
        
        if (items.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center text-muted py-4">
                        <i class="fas fa-check-circle fa-2x mb-2"></i>
                        <div>Нет активных заявок на товары</div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = items.map(item => `
            <tr>
                <td class="fw-semibold">${item.subject}</td>
                <td class="text-center">
                    <span class="badge bg-primary fs-6">${item.total_quantity}</span>
                </td>
                <td class="text-center">${item.total_requests}</td>
                <td class="text-center">
                    ${item.urgent_requests > 0 ? `<span class="badge bg-danger">${item.urgent_requests}</span>` : '-'}
                </td>
                <td class="text-center">
                    ${item.high_requests > 0 ? `<span class="badge bg-warning text-dark">${item.high_requests}</span>` : '-'}
                </td>
                <td>
                    ${item.earliest_need_date === item.latest_need_date 
                        ? item.earliest_need_date 
                        : `${item.earliest_need_date} - ${item.latest_need_date}`}
                </td>
                <td>
                    <small>${item.requester_names.split(',').slice(0, 2).join(', ')}${item.requester_names.split(',').length > 2 ? '...' : ''}</small>
                </td>
            </tr>
        `).join('');
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new ReportViewer();
});