export function initErrorScreen() {
    const el = document.getElementById('error-screen');
    el.querySelector('#error-title').textContent = '';
    return { show(title, detail) {
            el.querySelector('#error-title').textContent = title;
            el.querySelector('#error-detail').textContent = detail;
            el.classList.remove('hidden');
        } };
}
