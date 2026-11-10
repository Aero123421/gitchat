// Git actions run only for input the browser attributes to the user.
// The widget's shadow root stays open (the extension and its tests read it), so a host
// page can reach the buttons and dispatch clicks. It cannot set isTrusted.

/** @param {Event | null | undefined} event */
export function isUserInput(event) {
  return event?.isTrusted === true;
}
