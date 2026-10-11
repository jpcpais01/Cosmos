import { PATCH_NOTES } from '../data/patchNotes';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Fills the title screen's patch notes panel from src/data/patchNotes.ts. */
export function renderPatchNotes(list: HTMLElement): void {
  for (const entry of PATCH_NOTES) {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'note-head';
    const title = document.createElement('span');
    title.className = 'note-title';
    title.textContent = entry.title;
    const meta = document.createElement('span');
    meta.className = 'note-meta';
    meta.textContent = `v${entry.version} · ${fmtDate(entry.date)}`;
    head.append(title, meta);
    const notes = document.createElement('ul');
    for (const text of entry.notes) {
      const item = document.createElement('li');
      item.textContent = text;
      notes.append(item);
    }
    li.append(head, notes);
    list.append(li);
  }
}
