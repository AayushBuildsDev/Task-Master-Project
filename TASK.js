const API_URL = 'http://localhost:5005/api/tasks';

// A helper to get user ID
const getUserId = () => {
    return localStorage.getItem('userEmail') || localStorage.getItem('userName') || 'guest';
};

// Global task cache
let tasks = [];
let taskChartInstance = null;

// --- Custom Category Helpers ---
const DEFAULT_CATEGORIES = ['Work', 'Personal', 'Study', 'Health', 'Finance'];

function getCustomCategories() {
    return JSON.parse(localStorage.getItem('customCategories') || '[]');
}

function saveCustomCategory(cat) {
    const cats = getCustomCategories();
    const trimmed = cat.trim();
    if (trimmed && !cats.includes(trimmed) && !DEFAULT_CATEGORIES.includes(trimmed)) {
        cats.push(trimmed);
        localStorage.setItem('customCategories', JSON.stringify(cats));
    }
    return trimmed;
}

function populateCategoryDropdown(selectEl) {
    if (!selectEl) return;
    const customs = getCustomCategories();
    // Remove old custom options (keep defaults + 'other')
    const existingValues = new Set();
    Array.from(selectEl.options).forEach(opt => existingValues.add(opt.value));
    
    // Find where 'other' option is
    const otherOption = selectEl.querySelector('option[value="other"]');
    
    customs.forEach(cat => {
        if (!existingValues.has(cat)) {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            // Insert before the 'other' option
            if (otherOption) {
                selectEl.insertBefore(opt, otherOption);
            } else {
                selectEl.appendChild(opt);
            }
        }
    });
}

function setupCategoryToggle(selectId, inputId) {
    const select = document.getElementById(selectId);
    const input = document.getElementById(inputId);
    if (!select || !input) return;
    
    populateCategoryDropdown(select);
    
    select.addEventListener('change', () => {
        if (select.value === 'other') {
            input.style.display = 'block';
            input.focus();
        } else {
            input.style.display = 'none';
            input.value = '';
        }
    });
}

// --- Duration Helpers ---
function setupDurationToggle(selectId, inputId) {
    const select = document.getElementById(selectId);
    const input = document.getElementById(inputId);
    if (!select || !input) return;
    
    select.addEventListener('change', () => {
        if (select.value === 'custom') {
            input.style.display = 'block';
            input.focus();
        } else {
            input.style.display = 'none';
            input.value = '';
        }
    });
}

function getDurationValue(selectId, inputId) {
    const select = document.getElementById(selectId);
    const input = document.getElementById(inputId);
    if (!select) return 60;
    
    if (select.value === 'custom' && input && input.value) {
        return parseInt(input.value, 10) || 60;
    }
    return parseInt(select.value, 10) || 60;
}

function formatDuration(minutes) {
    if (!minutes || minutes <= 0) return '1h';
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

async function fetchTasksFromAPI() {
    try {
        const response = await fetch(`${API_URL}/${getUserId()}`);
        tasks = await response.json();
    } catch (e) {
        console.error("Failed to fetch tasks", e);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // Selectors
    const signupForm = document.getElementById('signupForm');
    const loginForm = document.getElementById('LoginForm');
    const createTaskForm = document.getElementById('createTaskForm');
    const taskListBody = document.getElementById('task-list-body');
    const nameDisplay = document.getElementById('display-name');
    const profileName = document.getElementById('userNameDisplay');
    const profileEmail = document.getElementById('userEmailDisplay');
    const delBtn = document.getElementById('delete-selected-btn');

    // 0. Theme Toggle
    const themeBtn = document.getElementById('theme-toggle');
    const currentTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);

    if (themeBtn) {
        themeBtn.onclick = () => {
            const current = document.documentElement.getAttribute('data-theme');
            const target = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', target);
            localStorage.setItem('theme', target);
        };
    }

    // 1. Initialize Dashboard Stats
    if (document.getElementById('stat-total')) {
        await fetchTasksFromAPI();
        updateDashboardStats();
        buildScheduleGrid();
        // Auto-sync with Google Calendar in background
        autoSyncGoogleCalendar();
    }

    // 2. Signup Logic
    if (signupForm) {
        signupForm.onsubmit = async (e) => {
            e.preventDefault();
            const name = document.getElementById('fullname').value;
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                const res = await fetch('http://localhost:5005/api/users/signup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password })
                });

                if (res.ok) {
                    window.location.href = "Login.html";
                } else {
                    const data = await res.json();
                    alert("Signup Failed: " + data.error);
                }
            } catch (err) {
                console.error("Signup error", err);
            }
        };
    }
    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();
            const enteredName = document.getElementById('UserName').value;
            const enteredPass = document.getElementById('password').value;

            const oldError = document.getElementById('login-error');
            if (oldError) oldError.remove();

            try {
                const res = await fetch('http://localhost:5005/api/users/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: enteredName, password: enteredPass })
                });

                if (res.ok) {
                    const data = await res.json();
                    localStorage.setItem('userName', data.user.name);
                    localStorage.setItem('userEmail', data.user.email);
                    localStorage.setItem('authStatus', 'returning_user');
                    window.location.href = 'Home.html';
                } else {
                    const data = await res.json();
                    const errorMsg = document.createElement('p');
                    errorMsg.id = "login-error";
                    errorMsg.innerText = "❌ " + (data.error || "Wrong Username or Password!");
                    errorMsg.style = "color:red; margin-bottom:10px; font-size:14px; font-weight:bold;";
                    loginForm.insertBefore(errorMsg, loginForm.querySelector('.btn-primary'));
                }
            } catch (err) {
                console.error("Login Error", err);
            }
        };
    }

    // 4. Greetings & Profile Sync
    if (nameDisplay) {
        nameDisplay.innerText = localStorage.getItem('userName') || 'Guest';
        const status = localStorage.getItem('authStatus');
        const welcomeTitle = document.querySelector('.welcome-box h1');
        if (status === 'returning_user' && welcomeTitle) {
            welcomeTitle.innerText = "Welcome Back to Task Master";
        }
    }

    if (profileName) profileName.innerText = localStorage.getItem('userName') || 'Guest';
    if (profileEmail) profileEmail.innerText = localStorage.getItem('userEmail') || 'Not Set';

    // 5. Create Task
    if (createTaskForm) {
        setupCategoryToggle('task-type', 'custom-category');
        setupDurationToggle('task-duration', 'custom-duration');
        
        createTaskForm.onsubmit = async (e) => {
            e.preventDefault();
            const selectVal = document.getElementById('task-type').value;
            const customInput = document.getElementById('custom-category');
            let category = selectVal;
            
            if (selectVal === 'other' && customInput && customInput.value.trim()) {
                category = saveCustomCategory(customInput.value);
            }
            
            const newTask = {
                name: document.getElementById('task-name').value,
                category: category,
                date: document.getElementById('due-date').value,
                time: document.getElementById('due-time') ? document.getElementById('due-time').value : '',
                duration: getDurationValue('task-duration', 'custom-duration'),
                priority: document.getElementById('priority').value,
                status: 'Pending',
                userId: getUserId()
            };

            try {
                await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newTask)
                });
                window.location.href = 'view.html';
            } catch (err) {
                console.error('Error creating task', err);
            }
        };
    }

    // 6. View Tasks & Delete Logic
    if (taskListBody) {
        await fetchTasksFromAPI();
        renderTasks();
        setupSearch(taskListBody);
    }
    if (delBtn) {
        delBtn.onclick = async () => {
            const checkboxes = document.querySelectorAll('.task-checkbox:checked');

            if (checkboxes.length === 0) {
                return;
            }
            const userConfirmed = confirm(`Are you sure you want to delete ${checkboxes.length} selected task(s)?`);

            if (userConfirmed) {
                const idsToDelete = Array.from(checkboxes).map(cb => cb.dataset.id);
                try {
                    await fetch(`${API_URL}/delete`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: idsToDelete })
                    });

                    idsToDelete.forEach(id => {
                        const tr = document.getElementById(`task-row-${id}`);
                        if (tr) {
                            tr.classList.add('task-fade-out');
                            setTimeout(() => tr.remove(), 500);
                        }
                    });

                    tasks = tasks.filter(t => !idsToDelete.includes(t._id));
                    updateDashboardStats();
                } catch (e) { console.error('Error deleting', e) }
            }
        };
    }

    // 7. Edit Task
    const editTaskForm = document.getElementById('editTaskForm');
    if (editTaskForm) {
        setupCategoryToggle('edit-task-type', 'edit-custom-category');
        setupDurationToggle('edit-duration', 'edit-custom-duration');
        
        editTaskForm.onsubmit = async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-task-id').value;
            const editSelectVal = document.getElementById('edit-task-type').value;
            const editCustomInput = document.getElementById('edit-custom-category');
            let editCategory = editSelectVal;
            
            if (editSelectVal === 'other' && editCustomInput && editCustomInput.value.trim()) {
                editCategory = saveCustomCategory(editCustomInput.value);
            }
            
            const updatedTask = {
                name: document.getElementById('edit-task-name').value,
                category: editCategory,
                date: document.getElementById('edit-due-date').value,
                time: document.getElementById('edit-due-time') ? document.getElementById('edit-due-time').value : '',
                duration: getDurationValue('edit-duration', 'edit-custom-duration'),
                priority: document.getElementById('edit-priority').value,
            };

            try {
                const res = await fetch(`${API_URL}/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedTask)
                });
                if (res.ok) {
                    const idx = tasks.findIndex(t => t._id === id);
                    if (idx !== -1) {
                        tasks[idx].name = updatedTask.name;
                        tasks[idx].category = updatedTask.category;
                        tasks[idx].date = updatedTask.date;
                        tasks[idx].time = updatedTask.time;
                        tasks[idx].duration = updatedTask.duration;
                        tasks[idx].priority = updatedTask.priority;
                    }
                    closeEditModal();
                    renderTasks();
                    updateDashboardStats();
                }
            } catch (err) {
                console.error("error updating task", err);
            }
        };
    }
});

// --- CORE FUNCTIONS ---

function updateDashboardStats() {
    // Use local time for 'today' to match user expectations
    const localNow = new Date();
    const today = localNow.toLocaleDateString('en-CA'); 
    
    // Calculate start of current week (Monday)
    const day = localNow.getDay();
    const diff = localNow.getDate() - day + (day === 0 ? -6 : 1);
    const startOfWeekDate = new Date(localNow.setDate(diff));
    const startOfWeek = startOfWeekDate.toLocaleDateString('en-CA');

    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'Completed').length;
    
    // Due today should ideally show all tasks for today, or pending ones. 
    // To match user expectation of seeing progress, we'll keep it as pending tasks due today 
    // but ensure the count is correctly updated.
    const due = tasks.filter(t => t.date === today && t.status !== 'Completed').length;
    
    // Weekly progress: Completed tasks due between Monday and today
    const weeklyCompleted = tasks.filter(t => 
        t.status === 'Completed' && 
        t.date >= startOfWeek && 
        t.date <= today
    ).length;

    const overdue = tasks.filter(t => t.date && t.date < today && t.status !== 'Completed').length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    const ids = ['stat-total', 'stat-completed', 'stat-pending', 'stat-due', 'stat-weekly'];
    const vals = [total, completed, total - completed, due, weeklyCompleted];

    ids.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el) el.innerText = vals[i];
    });

    const elCompletionRate = document.getElementById('stat-completion-rate');
    if (elCompletionRate) elCompletionRate.innerText = `${progress}% completion rate`;

    const elOverdue = document.getElementById('stat-overdue');
    if (elOverdue) elOverdue.innerText = overdue;

    // Progress circle
    const circle = document.getElementById('overall-progress-circle');
    const percentText = document.getElementById('progress-percent');
    if (circle) circle.setAttribute('stroke-dasharray', `${progress}, 100`);
    if (percentText) percentText.innerHTML = `${progress}%<br><span style="font-size:10px;color:var(--text-muted)">Complete</span>`;

    // Priority bars
    const pendingTasks = tasks.filter(t => t.status !== 'Completed');
    const pendingTotal = pendingTasks.length;
    const pHigh = pendingTasks.filter(t => t.priority === 'high').length;
    const pMedium = pendingTasks.filter(t => t.priority === 'medium').length;
    const pLow = pendingTasks.filter(t => t.priority === 'low').length;
    const pNone = pendingTasks.filter(t => !t.priority || t.priority === 'none').length;

    const setBar = (id, count, totalCount) => {
        const valEl = document.getElementById(`val-${id}`);
        const barEl = document.getElementById(`pb-${id}`);
        if (valEl) valEl.innerText = count;
        if (barEl) barEl.style.width = totalCount > 0 ? `${(count / totalCount) * 100}%` : '0%';
    }

    setBar('high', pHigh, pendingTotal);
    setBar('medium', pMedium, pendingTotal);
    setBar('low', pLow, pendingTotal);
    setBar('none', pNone, pendingTotal);
}

window.renderTasks = function (filter = "") {
    const tbody = document.getElementById('task-list-body');
    if (!tbody) return;

    let displayTasks = tasks;
    if (filter) {
        displayTasks = displayTasks.filter(t => t.name.toLowerCase().includes(filter));
    }

    // Disappear condition: hide completed ones visually from the 'pending' view if you like, or let them just animate and be hidden.
    // The requirement is "make the task disappear like it is completed".
    // I will filter out completed tasks here so they don't load next time, or if I want them hidden.
    // Let's filter out 'Completed' tasks from the viewer.
    displayTasks = displayTasks.filter(t => t.status !== 'Completed');

    tbody.innerHTML = displayTasks.length === 0 ? '<tr><td colspan="6" style="text-align:center; padding:20px; color: var(--text-muted);">No pending tasks.</td></tr>' :
        displayTasks.map(t => `
        <tr id="task-row-${t._id}">
            <td><input type="checkbox" class="task-checkbox" data-id="${t._id}"></td>
            <td onclick="editTask('${t._id}')" style="cursor:pointer; color:var(--primary-color); font-weight: 500;">
                <div style="display:flex; align-items:center; gap:5px;">
                    ${t.name}
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                </div>
            </td>
            <td>${t.category}</td>
            <td>${t.date}${t.time ? ' <span style="color:var(--primary-color); font-size:12px;">⏰ ' + t.time + '</span>' : ''}${t.duration ? ' <span style="color:var(--text-muted); font-size:11px;">⏱ ' + formatDuration(t.duration) + '</span>' : ''}</td>
            <td><b style="color:${t.priority === 'high' ? 'var(--color-red)' : (t.priority === 'medium' ? 'var(--color-orange)' : 'var(--color-green)')}">${t.priority ? t.priority.toUpperCase() : 'NONE'}</b></td>
            <td style="text-align: center;">
                <input type="checkbox" onclick="this.disabled=true; markCompleted('${t._id}')" style="cursor: pointer; width: 22px; height: 22px; accent-color: var(--color-green);" title="Mark as Complete">
            </td>
        </tr>`).join('');
};

window.markCompleted = async function (id) {
    const task = tasks.find(t => t._id === id);
    if (!task) return;

    // Add vanish visual to the row
    const row = document.getElementById(`task-row-${id}`);
    if (row) {
        row.classList.add('task-fade-out');
    }

    // Vanish inside quick task view
    const quickRow = document.getElementById(`quick-task-${id}`);
    if (quickRow) {
        quickRow.style.opacity = '0';
        quickRow.style.transition = 'opacity 0.5s';
    }

    task.status = 'Completed';

    try {
        await fetch(`${API_URL}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Completed' })
        });

        // Wait for animation, then remove
        setTimeout(() => {
            if (row) row.remove();
            if (quickRow) quickRow.remove();
            updateDashboardStats();

            // Make sure quick view stats reflect the change
            const qtv = document.getElementById('quick-task-view');
            if (qtv && qtv.style.display !== 'none' && window.currentQuickViewCategory) {
                showTaskCategory(window.currentQuickViewCategory);
            }
        }, 500);

    } catch (err) {
        console.error('Error updating task', err);
        // revert visual if failed
        if (row) row.classList.remove('task-fade-out');
        if (quickRow) {
            quickRow.style.opacity = '1';
        }
    }
};


window.editTask = async function (id) {
    const task = tasks.find(t => t._id === id);
    if (task) {
        document.getElementById('edit-task-id').value = id;
        document.getElementById('edit-task-name').value = task.name;
        
        // Handle custom categories in the edit dropdown
        const editSelect = document.getElementById('edit-task-type');
        const editCustomInput = document.getElementById('edit-custom-category');
        populateCategoryDropdown(editSelect);
        
        const cat = task.category || 'other';
        // Check if the category exists as an option
        const optionExists = Array.from(editSelect.options).some(opt => opt.value === cat);
        if (optionExists) {
            editSelect.value = cat;
            if (editCustomInput) editCustomInput.style.display = 'none';
        } else {
            // It's a custom category not yet saved — add it
            saveCustomCategory(cat);
            populateCategoryDropdown(editSelect);
            editSelect.value = cat;
            if (editCustomInput) editCustomInput.style.display = 'none';
        }
        
        document.getElementById('edit-due-date').value = task.date || '';
        const editTimeEl = document.getElementById('edit-due-time');
        if (editTimeEl) editTimeEl.value = task.time || '';
        document.getElementById('edit-priority').value = task.priority || 'medium';
        
        // Populate duration
        const editDurationEl = document.getElementById('edit-duration');
        const editCustomDurationEl = document.getElementById('edit-custom-duration');
        if (editDurationEl) {
            const dur = task.duration || 60;
            const standardValues = ['15','30','45','60','90','120','180','240'];
            if (standardValues.includes(String(dur))) {
                editDurationEl.value = String(dur);
                if (editCustomDurationEl) editCustomDurationEl.style.display = 'none';
            } else {
                editDurationEl.value = 'custom';
                if (editCustomDurationEl) {
                    editCustomDurationEl.style.display = 'block';
                    editCustomDurationEl.value = dur;
                }
            }
        }
        
        document.getElementById('editTaskModal').style.display = 'block';
    }
};

window.closeEditModal = function() {
    const modal = document.getElementById('editTaskModal');
    if (modal) {
        modal.style.display = 'none';
    }
};

function setupSearch(taskListBody) {
    if (!document.getElementById('taskSearch')) {
        const search = document.createElement('input');
        search.id = "taskSearch";
        search.placeholder = "🔍 Search tasks by name...";
        search.style = "width:100%; padding:12px; margin-bottom:15px; border:1px solid #ddd; border-radius:8px;";
        taskListBody.closest('.welcome-box').prepend(search);
        search.oninput = (e) => renderTasks(e.target.value.toLowerCase());
    }
}

window.logout = function () {
    localStorage.removeItem('userName');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('authStatus');
    window.location.href = "Login.html";
};

// --- Open Google Calendar ---
window.openGoogleCalendar = function() {
    window.open('https://calendar.google.com', '_blank');
};

// --- Auto-sync Google Calendar (background, no alert) ---
window.autoSyncGoogleCalendar = async function() {
    const userId = getUserId();
    if (userId === 'guest') return; // Don't auto-sync for guests
    
    const banner = document.getElementById('auto-sync-status');
    const statusText = document.getElementById('sync-status-text');
    if (!banner) return;
    
    // Show syncing indicator
    banner.style.display = 'flex';
    banner.className = 'auto-sync-banner';
    if (statusText) statusText.textContent = '🔄 Auto-syncing with Google Calendar...';
    
    try {
        const encodedUserId = encodeURIComponent(userId);
        const res = await fetch(`http://localhost:5005/api/tasks/sync/${encodedUserId}`, {
            method: 'POST'
        });
        const data = await res.json();
        
        if (res.status === 401 && data.notLinked) {
            // Not linked — show subtle message
            banner.className = 'auto-sync-banner error';
            if (statusText) statusText.innerHTML = '⚠️ Google Calendar not linked. <a href="#" onclick="syncGoogleCalendar(); return false;" style="color: #4285F4; font-weight: 600; text-decoration: underline;">Link now →</a>';
            // Hide after 8 seconds
            setTimeout(() => { banner.style.display = 'none'; }, 8000);
        } else if (res.ok) {
            banner.className = 'auto-sync-banner success';
            const parts = [];
            if (data.pushedCount > 0) parts.push(`📤 ${data.pushedCount} pushed`);
            if (data.pulledCount > 0) parts.push(`📥 ${data.pulledCount} pulled`);
            if (statusText) statusText.textContent = parts.length > 0 
                ? `✅ Calendar synced! ${parts.join(' • ')}` 
                : '✅ Calendar is up to date';
            
            // If new tasks pulled, refresh data
            if (data.pulledCount > 0) {
                await fetchTasksFromAPI();
                updateDashboardStats();
                buildScheduleGrid();
            }
            // Hide after 5 seconds
            setTimeout(() => { banner.style.display = 'none'; }, 5000);
        } else {
            banner.style.display = 'none';
        }
    } catch(err) {
        console.log('Auto-sync skipped (server may not be running)');
        banner.style.display = 'none';
    }
};

window.syncGoogleCalendar = async function() {
    const userId = getUserId();
    if (userId === 'guest') {
        alert("You are not logged in. Redirecting to Google Login...");
        window.location.href = 'http://localhost:5005/api/auth/google?userId=login';
        return;
    }
    
    // Attempt to sync using existing tokens or start linking process
    try {
        const encodedUserId = encodeURIComponent(userId);
        const res = await fetch(`http://localhost:5005/api/tasks/sync/${encodedUserId}`, {
            method: 'POST'
        });
        const data = await res.json();
        
        if (res.status === 401 && data.notLinked) {
            // Initiate OAuth flow — redirect to Google to link account
            window.location.href = `http://localhost:5005/api/auth/google?userId=${encodedUserId}`;
        } else if (res.ok) {
            alert(`✅ Sync complete!\n\n📤 ${data.pushedCount} task(s) pushed to Google Calendar\n📥 ${data.pulledCount} event(s) pulled from Google Calendar`);
            window.location.reload();
        } else {
            alert("Error syncing: " + data.error);
        }
    } catch(err) {
        console.error("Sync error", err);
        alert("Could not reach the server for sync. Make sure server is running on port 5005.");
    }
};

window.showTaskCategory = function(category) {
    const qtv = document.getElementById('quick-task-view');
    const title = document.getElementById('quick-view-title');
    const ul = document.getElementById('quick-pending-ul');
    if (!qtv || !title || !ul) return;

    qtv.classList.add('active');
    window.currentQuickViewCategory = category;

    const today = new Date().toISOString().split('T')[0];
    let filteredTasks = [];
    let titleText = '';
    let titleIcon = '';
    let titleColor = '';

    switch (category) {
        case 'total':
            filteredTasks = tasks;
            titleText = 'All Tasks';
            titleIcon = '📋';
            titleColor = 'var(--primary-color)';
            break;
        case 'completed':
            filteredTasks = tasks.filter(t => t.status === 'Completed');
            titleText = 'Completed Tasks';
            titleIcon = '✅';
            titleColor = 'var(--color-green)';
            break;
        case 'pending':
            filteredTasks = tasks.filter(t => t.status !== 'Completed');
            titleText = 'Pending Tasks';
            titleIcon = '⏳';
            titleColor = 'var(--color-orange)';
            break;
        case 'overdue':
            filteredTasks = tasks.filter(t => t.date && t.date < today && t.status !== 'Completed');
            titleText = 'Overdue Tasks';
            titleIcon = '🚨';
            titleColor = 'var(--color-red)';
            break;
    }

    title.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${titleColor}" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
        <span>${titleIcon} ${titleText}</span>
        <span style="font-size: 13px; font-weight: 400; color: var(--text-muted); margin-left: 4px;">(${filteredTasks.length})</span>
    `;

    if (filteredTasks.length === 0) {
        ul.innerHTML = `<li class="quick-task-item" style="justify-content: center;">
            <span style="color: var(--text-muted); font-size: 14px;">No tasks found in this category</span>
        </li>`;
        return;
    }

    ul.innerHTML = filteredTasks.map(t => {
        const isCompleted = t.status === 'Completed';
        const isOverdue = t.date && t.date < today && !isCompleted;
        const priorityClass = t.priority || 'none';
        
        return `
        <li class="quick-task-item" id="quick-task-${t._id}">
            <div class="task-info">
                <span class="task-name" style="${isCompleted ? 'text-decoration: line-through; opacity: 0.6;' : ''}">
                    ${t.name}
                </span>
                <span class="task-meta">
                    <span>${t.date ? '📅 ' + t.date : 'No Date'}${t.time ? ' ⏰ ' + t.time : ''}${t.duration ? ' ⏱ ' + formatDuration(t.duration) : ''}</span>
                    <span class="priority-badge ${priorityClass}">${(t.priority || 'none').toUpperCase()}</span>
                    ${isOverdue ? '<span style="color: var(--color-red); font-weight: 600;">⚠ OVERDUE</span>' : ''}
                </span>
            </div>
            ${!isCompleted ? 
                `<input type="checkbox" onclick="this.disabled=true; markCompleted('${t._id}')" style="cursor: pointer; width: 22px; height: 22px; accent-color: var(--color-green); flex-shrink: 0;" title="Mark as Complete">` :
                `<span style="color: var(--color-green); font-weight: 600; font-size: 12px; white-space: nowrap;">✓ Done</span>`
            }
        </li>
    `}).join('');
};

// =========================================
//   WEEKLY SCHEDULE BUILDER
// =========================================
let scheduleWeekOffset = 0;

window.navigateWeek = function(direction) {
    scheduleWeekOffset += direction;
    buildScheduleGrid();
};

function getWeekDates(offset = 0) {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(now);
    monday.setDate(diff + (offset * 7));
    
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(d);
    }
    return dates;
}

function formatDateLabel(date) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}`;
}

function buildScheduleGrid() {
    const tbody = document.getElementById('schedule-body');
    const weekLabel = document.getElementById('schedule-week-label');
    if (!tbody) return;

    const weekDates = getWeekDates(scheduleWeekOffset);
    const todayStr = new Date().toLocaleDateString('en-CA');
    
    // Update header label
    if (weekLabel) {
        if (scheduleWeekOffset === 0) {
            weekLabel.textContent = 'This Week';
        } else if (scheduleWeekOffset === 1) {
            weekLabel.textContent = 'Next Week';
        } else if (scheduleWeekOffset === -1) {
            weekLabel.textContent = 'Last Week';
        } else {
            weekLabel.textContent = `${formatDateLabel(weekDates[0])} – ${formatDateLabel(weekDates[6])}`;
        }
    }

    // Update column headers with dates and highlight today
    const thead = document.querySelector('#schedule-table thead tr');
    if (thead) {
        const dayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
        thead.innerHTML = '<th class="schedule-time-col">Time</th>';
        weekDates.forEach((date, i) => {
            const dateStr = date.toLocaleDateString('en-CA');
            const isToday = dateStr === todayStr;
            thead.innerHTML += `<th class="${isToday ? 'today-col' : ''}">
                ${dayNames[i]}<br>
                <span style="font-size: 10px; font-weight: 400; opacity: 0.7;">${formatDateLabel(date)}</span>
            </th>`;
        });
    }

    // Build time slots from 6 AM to 10 PM
    const timeSlots = [];
    for (let h = 6; h <= 22; h++) {
        const label = h <= 12 ? `${h === 0 ? 12 : h}${h < 12 ? ' AM' : ' PM'}` : `${h - 12} PM`;
        timeSlots.push({ hour: h, label });
    }

    // Map tasks to their day + hour
    const taskMap = {}; // key: 'YYYY-MM-DD_HH' => [tasks]
    const allDayTasks = {}; // key: 'YYYY-MM-DD' => [tasks]
    
    const pendingTasks = tasks.filter(t => t.status !== 'Completed');
    
    pendingTasks.forEach(t => {
        if (!t.date) return;
        const dateStr = t.date;
        
        if (t.time) {
            const hour = parseInt(t.time.split(':')[0], 10);
            const key = `${dateStr}_${hour}`;
            if (!taskMap[key]) taskMap[key] = [];
            taskMap[key].push(t);
        } else {
            if (!allDayTasks[dateStr]) allDayTasks[dateStr] = [];
            allDayTasks[dateStr].push(t);
        }
    });

    // Check if any tasks exist for this week
    const weekDateStrs = weekDates.map(d => d.toLocaleDateString('en-CA'));

    let html = '';

    // All-day row
    html += '<tr>';
    html += '<td class="time-cell" style="font-weight: 600; color: var(--primary-color);">All Day</td>';
    weekDates.forEach(date => {
        const dateStr = date.toLocaleDateString('en-CA');
        const isToday = dateStr === todayStr;
        const dayTasks = allDayTasks[dateStr] || [];
        html += `<td class="${isToday ? 'today-highlight' : ''}">`;
        dayTasks.forEach(t => {
            const pClass = 'priority-' + (t.priority || 'none');
            html += `<div class="schedule-task-chip ${pClass}" title="${t.name}\n${t.category || 'General'} | Priority: ${(t.priority || 'none').toUpperCase()} | Duration: ${formatDuration(t.duration || 60)}">
                <span class="chip-name">${t.name}</span>
                <span class="chip-category">${t.category || 'General'} • ⏱ ${formatDuration(t.duration || 60)}</span>
            </div>`;
        });
        html += '</td>';
    });
    html += '</tr>';

    // Hourly rows
    timeSlots.forEach(slot => {
        html += '<tr>';
        html += `<td class="time-cell">${slot.label}</td>`;
        weekDates.forEach(date => {
            const dateStr = date.toLocaleDateString('en-CA');
            const isToday = dateStr === todayStr;
            const key = `${dateStr}_${slot.hour}`;
            const cellTasks = taskMap[key] || [];
            html += `<td class="${isToday ? 'today-highlight' : ''}">`;
            cellTasks.forEach(t => {
                const pClass = 'priority-' + (t.priority || 'none');
                html += `<div class="schedule-task-chip ${pClass}" title="${t.name}\n${t.time} | ${t.category || 'General'} | Duration: ${formatDuration(t.duration || 60)}">
                    <span class="chip-name">${t.name}</span>
                    <span class="chip-category">⏰ ${t.time} • ⏱ ${formatDuration(t.duration || 60)}</span>
                </div>`;
            });
            html += '</td>';
        });
        html += '</tr>';
    });

    tbody.innerHTML = html;
}