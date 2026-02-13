// Toast System (For minor notifications)
function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            top: 24px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10000;
            display: flex;
            flex-direction: column;
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
    let bgColor = 'rgba(15, 23, 42, 0.9)'; // dark navy

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

    toast.className = `flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl backdrop-blur-md text-white transition-all duration-500 transform translate-y-[-20px] opacity-0 pointer-events-auto`;
    toast.style.backgroundColor = bgColor;
    toast.style.borderBottom = `4px solid ${borderColor}`;

    toast.innerHTML = `
        <span class="material-icons-outlined text-xl" style="color: ${borderColor}">${icon}</span>
        <span class="text-sm font-medium tracking-wide">${message}</span>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    });

    setTimeout(() => {
        toast.style.transform = 'translateY(-20px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 4000);
}

// Result Modal System (For major events like Registration)
function showResultModal({ title, message, type = 'success', buttonText = 'ตกลง', duration = 0, onAction }) {
    // Remove existing modal if any
    const existing = document.getElementById('result-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'result-modal-overlay';
    overlay.className = 'fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-background-dark/80 backdrop-blur-sm transition-opacity duration-300 opacity-0';

    const isSuccess = type === 'success';
    const accentColor = isSuccess ? '#22c55e' : '#ef4444';
    const iconName = isSuccess ? 'check' : 'close';
    const glowClass = isSuccess ? 'success-glow' : 'error-glow';

    // Add required styles dynamicially if not present
    if (!document.getElementById('modal-extra-styles')) {
        const style = document.createElement('style');
        style.id = 'modal-extra-styles';
        style.innerHTML = `
            .success-glow { box-shadow: 0 0 30px rgba(34, 197, 94, 0.4); }
            .error-glow { box-shadow: 0 0 30px rgba(239, 68, 68, 0.4); }
            @keyframes modal-pop {
                0% { transform: scale(0.9); opacity: 0; }
                100% { transform: scale(1); opacity: 1; }
            }
            @keyframes progress-linear {
                0% { width: 100%; }
                100% { width: 0%; }
            }
        `;
        document.head.appendChild(style);
    }

    overlay.innerHTML = `
        <div class="relative w-full max-w-md bg-[#0f172a] border border-white/10 rounded-2xl p-8 md:p-10 text-center shadow-2xl transform transition-transform duration-300 scale-95" style="animation: modal-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards">
            <!-- Icon -->
            <div class="flex justify-center mb-8">
                <div class="relative">
                    <div class="size-20 rounded-full border-4 flex items-center justify-center ${glowClass}" style="border-color: ${accentColor}; background-color: ${accentColor}1a">
                        <span class="material-icons-outlined text-5xl font-bold" style="color: ${accentColor}">${iconName}</span>
                    </div>
                    ${isSuccess ? '<div class="absolute -top-2 -right-2 animate-pulse text-green-400"><span class="material-icons-outlined text-xl">auto_awesome</span></div>' : ''}
                </div>
            </div>
            <!-- Content -->
            <div class="space-y-3 mb-10">
                <h2 class="text-white text-3xl font-bold tracking-tight">${title}</h2>
                <p class="text-slate-400 text-base font-normal leading-relaxed">${message}</p>
            </div>
            <!-- Action -->
            <button id="modal-action-btn" class="relative overflow-hidden w-full flex cursor-pointer items-center justify-center rounded-xl h-14 px-8 bg-primary text-white text-lg font-bold transition-all hover:brightness-110 active:scale-[0.98] shadow-lg shadow-primary/20">
                <span class="relative z-10 flex items-center">
                    <span class="truncate">${buttonText}</span>
                    <span class="material-icons-outlined ml-2 text-xl">arrow_forward</span>
                </span>
                ${duration > 0 ? `<div class="absolute bottom-0 left-0 h-1 bg-white/30" style="animation: progress-linear ${duration}ms linear forwards"></div>` : ''}
            </button>
        </div>
    `;

    document.body.appendChild(overlay);

    // Fade in
    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        overlay.classList.add('opacity-100');
    });

    const triggerAction = () => {
        if (overlay.dataset.triggered) return;
        overlay.dataset.triggered = "true";
        overlay.classList.add('opacity-0');
        setTimeout(() => {
            overlay.remove();
            if (onAction) onAction();
        }, 300);
    };

    const closeBtn = overlay.querySelector('#modal-action-btn');
    closeBtn.onclick = triggerAction;

    if (duration > 0) {
        setTimeout(triggerAction, duration);
    }
}
