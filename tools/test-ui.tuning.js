// Stand-in for src/game/tuning.js so the UI test page does not depend on the game code.
// tools/test-ui.html maps the real module to this file unless ?real is given.

export const WEAPONS = [
  { id: 'wrench', name: 'Torque Wrench', ammo: null },
  { id: 'rivet', name: 'Rivet Gun', ammo: 'rivets' },
  { id: 'scatter', name: 'Scattergun', ammo: 'shells' },
  { id: 'bolt', name: 'Bolt Driver', ammo: 'rivets' },
  { id: 'launcher', name: 'Thermal Launcher', ammo: 'canisters' },
];
