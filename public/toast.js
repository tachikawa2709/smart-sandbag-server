// Toast System (For minor notifications)
function showToast(message, type = 'info', duration = 2000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            bottom: 40px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10000;
            display: flex;
            flex-direction: column-reverse;
            gap: 12px;
            pointer-events: none;
            width: max-content;
            max-width: 90vw;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');

    let icon = 'info';
    let borderColor = '#3b82f6'; // primary
    let bgColor = 'rgba(15, 23, 42, 0.95)'; // dark navy

    if (type === 'success') {
        icon = 'check_circle';
        borderColor = '#10b981'; // emerald
    } else if (type === 'error') {
        icon = 'error_outline';
        borderColor = '#ef4444'; // red
    } else if (type === 'warning') {
        icon = 'warning_amber';
        borderColor = '#f59e0b'; // amber
    }

    toast.className = `flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl backdrop-blur-md text-white transition-all duration-500 transform translate-y-[20px] opacity-0 pointer-events-auto`;
    toast.style.backgroundColor = bgColor;
    toast.style.borderBottom = `4px solid ${borderColor}`;

    toast.innerHTML = `
        <span class="material-symbols-outlined text-xl" style="color: ${borderColor}">${icon}</span>
        <span class="text-sm font-medium tracking-wide">${message}</span>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    });

    setTimeout(() => {
        toast.style.transform = 'translateY(20px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, duration);
}

// Result Modal System (For major events like Registration)
function showResultModal({ title, message, type = 'success', duration = 2000, onAction }) {
    const existing = document.getElementById('result-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'result-modal-overlay';
    overlay.className = 'fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-background-dark/90 backdrop-blur-md transition-opacity duration-300 opacity-0';

    const isSuccess = type === 'success';
    const accentColor = isSuccess ? '#22c55e' : '#ef4444';
    const iconName = isSuccess ? 'check' : 'close';
    const glowClass = isSuccess ? 'success-glow' : 'error-glow';

    if (!document.getElementById('modal-extra-styles')) {
        const style = document.createElement('style');
        style.id = 'modal-extra-styles';
        style.innerHTML = `
            .success-glow { box-shadow: 0 0 40px rgba(34, 197, 94, 0.5); }
            .error-glow { box-shadow: 0 0 40px rgba(239, 68, 68, 0.5); }
            @keyframes modal-pop-in {
                0% { transform: scale(0.5) translateY(20px); opacity: 0; }
                100% { transform: scale(1) translateY(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    overlay.innerHTML = `
        <div class="relative w-full max-w-sm bg-[#0f172a] border border-white/10 rounded-3xl p-10 text-center shadow-2xl transform transition-all" style="animation: modal-pop-in 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards">
            <!-- Icon Section -->
            <div class="flex justify-center mb-8">
                <div class="relative">
                    <div class="size-24 rounded-full border-4 flex items-center justify-center ${glowClass}" style="border-color: ${accentColor}; background-color: ${accentColor}1a">
                        <span class="material-symbols-outlined text-6xl font-bold" style="color: ${accentColor}">${iconName}</span>
                    </div>
                </div>
            </div>
            <!-- Text Content -->
            <div class="space-y-4">
                <h2 class="text-white text-3xl font-bold tracking-tight">${title}</h2>
                <div class="h-1 w-10 bg-white/20 mx-auto rounded-full"></div>
                <p class="text-slate-400 text-lg font-medium leading-relaxed">${message}</p>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        overlay.classList.add('opacity-100');
    });

    const triggerAction = () => {
        if (overlay.dataset.triggered) return;
        overlay.dataset.triggered = "true";
        overlay.style.opacity = '0';
        overlay.style.transform = 'scale(0.95)';
        setTimeout(() => {
            overlay.remove();
            if (onAction) onAction();
        }, 300);
    };

    // Auto close after duration
    setTimeout(triggerAction, duration);
}
// Confirm Modal System (For actions requiring confirmation like Logout)
function showConfirmModal({ title, message, confirmText = "Confirm", cancelText = "Cancel", type = 'warning', onConfirm, onCancel }) {
    const existing = document.getElementById('result-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'result-modal-overlay';
    overlay.className = 'fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-background-dark/90 backdrop-blur-md transition-opacity duration-300 opacity-0';

    const accentColor = type === 'warning' ? '#f59e0b' : '#ef4444';
    const iconName = type === 'warning' ? 'priority_high' : 'logout';

    overlay.innerHTML = `
        <div class="relative w-full max-w-sm bg-[#0f172a] border border-white/10 rounded-[2.5rem] p-10 text-center shadow-2xl transform transition-all" style="animation: modal-pop-in 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards">
            <!-- Icon Section -->
            <div class="flex justify-center mb-8">
                <div class="relative">
                    <div class="size-24 rounded-full border-4 border-amber-500/50 flex items-center justify-center shadow-[0_0_40px_rgba(245,158,11,0.3)]" style="background-color: #f59e0b1a">
                        <span class="material-symbols-outlined text-6xl font-bold text-amber-500">${iconName}</span>
                    </div>
                </div>
            </div>
            <!-- Text Content -->
            <div class="space-y-4 mb-10">
                <h2 class="text-white text-3xl font-bold tracking-tight">${title}</h2>
                <div class="h-1 w-10 bg-white/20 mx-auto rounded-full"></div>
                <p class="text-slate-400 text-lg font-medium leading-relaxed">${message}</p>
            </div>
            <!-- Buttons -->
            <div class="grid grid-cols-2 gap-4">
                <button id="modal-cancel-btn" class="py-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-2xl transition-all active:scale-[0.95]">
                    ${cancelText}
                </button>
                <button id="modal-confirm-btn" class="py-4 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-2xl transition-all shadow-lg shadow-amber-500/25 active:scale-[0.95]">
                    ${confirmText}
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        overlay.classList.add('opacity-100');
    });

    const close = (action) => {
        overlay.style.opacity = '0';
        overlay.style.transform = 'scale(0.95)';
        setTimeout(() => {
            overlay.remove();
            if (action) action();
        }, 300);
    };

    overlay.querySelector('#modal-cancel-btn').onclick = () => close(onCancel);
    overlay.querySelector('#modal-confirm-btn').onclick = () => close(onConfirm);

    // Also allow closing by clicking overlay outside the content
    overlay.onclick = (e) => {
        if (e.target === overlay) close(onCancel);
    };
}
