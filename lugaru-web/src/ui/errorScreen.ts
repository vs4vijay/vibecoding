export function initErrorScreen(): { show(title: string, detail: string): void } {
  const el = document.getElementById('error-screen')!;
  el.querySelector('#error-title')!.textContent = '';
  return { show(title, detail) {
    el.querySelector('#error-title')!.textContent = title;
    (el.querySelector('#error-detail') as HTMLElement).textContent = detail;
    el.classList.remove('hidden');
  }};
}
