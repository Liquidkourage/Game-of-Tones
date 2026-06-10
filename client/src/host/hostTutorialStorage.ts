const STORAGE_KEY = 'got-host-tutorial-v1';

export type HostTutorialStorage = {
  completed?: boolean;
  suggestionDismissed?: boolean;
};

function readStorage(): HostTutorialStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as HostTutorialStorage;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStorage(next: HostTutorialStorage): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

export function isHostTutorialCompleted(): boolean {
  return readStorage().completed === true;
}

export function setHostTutorialCompleted(completed: boolean): void {
  const prev = readStorage();
  writeStorage({ ...prev, completed });
}

export function isHostTutorialSuggestionDismissed(): boolean {
  return readStorage().suggestionDismissed === true;
}

export function setHostTutorialSuggestionDismissed(): void {
  const prev = readStorage();
  writeStorage({ ...prev, suggestionDismissed: true });
}

export function resetHostTutorialProgress(): void {
  writeStorage({ suggestionDismissed: readStorage().suggestionDismissed });
}
