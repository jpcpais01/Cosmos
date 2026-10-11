import { PATCH_NOTES, patchVersion } from '../data/patchNotes';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Fills the title screen's patch notes popup from src/data/patchNotes.ts and wires its open button. */
export function renderPatchNotes(list: HTMLElement): void {
  setupPopup(list);
  PATCH_NOTES.forEach((entry, i) => {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'note-head';
    const title = document.createElement('span');
    title.className = 'note-title';
    title.textContent = entry.title;
    const meta = document.createElement('span');
    meta.className = 'note-meta';
    meta.textContent = `v${patchVersion(i)} · ${fmtDate(entry.date)}`;
    head.append(title, meta);
    const notes = document.createElement('ul');
    for (const text of entry.notes) {
      const item = document.createElement('li');
      item.textContent = text;
      notes.append(item);
    }
    li.append(head, notes);
    list.append(li);
  });
}

/** The "What's new" button opens the popup; the close button, a click outside the card or Escape closes it. */
function setupPopup(list: HTMLElement): void {
  const pop = list.closest<HTMLElement>('.notes-pop');
  const btn = document.getElementById('notes-open');
  const ver = document.getElementById('notes-ver');
  if (!pop || !btn) return;
  if (ver && PATCH_NOTES.length) ver.textContent = `v${patchVersion(0)}`;
  const close = pop.querySelector<HTMLElement>('.notes-close');
  const isOpen = () => pop.classList.contains('open');
  const setOpen = (open: boolean) => {
    pop.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (open) {
      list.scrollTop = 0;
      close?.focus({ preventScroll: true });
    } else if (pop.contains(document.activeElement)) {
      btn.focus({ preventScroll: true });
    }
  };
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => setOpen(!isOpen()));
  pop.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-close]')) setOpen(false);
  });
  // while it is open, Escape closes it and Enter/Space must not launch the game behind it
  window.addEventListener(
    'keydown',
    (e) => {
      if (!isOpen()) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
      e.stopPropagation();
    },
    true,
  );
}
