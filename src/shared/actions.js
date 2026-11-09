// Which git actions a chat offers right now. Shared by the on-page widgets and the toolbar popup, so
// both offer the same thing in the same state (e.g. Push stays available after a failed automatic push).

/**
 * @param {{ tracked: boolean, phase: string }} state the chat's status
 * @param {{ autoCommit: boolean, autoPush: boolean }} settings
 * @returns {Array<'start' | 'cancel' | 'commit' | 'push'>}
 */
export function availableActions(state, settings) {
  if (state.phase === 'capturing') return ['cancel'];
  if (!state.tracked) return ['start'];
  /** @type {Array<'commit' | 'push'>} */
  const out = [];
  if (!settings.autoCommit) out.push('commit');
  // an automatic action hides its button, unless it failed and needs a hand
  if (!settings.autoPush || state.phase === 'error') out.push('push');
  return out;
}
