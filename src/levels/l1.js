// Level 1: Loading Dock. Authoring format in build.js.
//
// Airlock (west) -> dock bay. Taking the scattergun in the office (north) unlocks the doors to
// the hub and opens a closet behind the player. The amber door is on the hub's north wall.
// Hub -> flickering service corridor (east) -> freight hall around a cargo pit -> storage wing
// (south-west), where gunners hold a raised gallery reached by stairs or a lift. Taking the key
// opens the lockers; the gallery switch opens a shutter from the storage wing into the bay.
// Secrets: a rusted panel in the bay's west wall (vest), and a ledge in the hub's north-east
// corner reached through a rusted panel in the service corridor.

const wall = (wall) => ({ solid: true, wall });
const bay = { floor: 0, ceil: 3, ft: 'f_concrete', ct: 'c_pipes', wt: 'w_plate', light: 0.8 };
const hub = { floor: 0, ceil: 2.5, ft: 'f_plate', ct: 'c_light', wt: 'w_plate', light: 1 };
const freight = { floor: 0, ceil: 3, ft: 'f_plate', ct: 'c_pipes', wt: 'w_rust', light: 0.65 };
const store = { floor: 0, ceil: 3, ft: 'f_concrete', ct: 'c_dark', wt: 'w_concrete', light: 0.45 };
const gallery = { ...store, ft: 'f_grate', wt: 'w_hazard', light: 0.6 };
const closet = { floor: 0, ceil: 2, ft: 'f_rust', ct: 'c_dark', wt: 'w_concrete', light: 0.3 };
const exitRoom = { floor: 0.5, ceil: 2.5, ft: 'f_plate', ct: 'c_light', wt: 'w_panel', light: 0.85 };
const service = { floor: 0, ceil: 1.6, ft: 'f_grate', ct: 'c_pipes', wt: 'w_pipes', light: 0.55, flicker: 0.6 };

export default {
  id: 'l1',
  name: 'Loading Dock',
  intro: 'Cargo airlock 7. The dock office should still have a scattergun.',
  music: 0,
  par: 180,
  playerYaw: 0,
  map: [
    '#####################$$$$EE$$$$#####',
    '######!!!!!!!!!!!!###$lmmmmmml$#####',
    '######!Heeeeee!aq!###$mbmmmxbm$#####',
    '######!eee^eeeBqq!###$mmmmmmmm$#####',
    '######!eeeeeee!qa!###$mmmammmm$#####',
    '######!eseeese!!!!###$mmmmmmmm$#####',
    '######!eeeeeej!######$+uuuuuuu$#####',
    '######!!!!OO!!!#####::::=YY=::::||||',
    '##XX{#%ffffffffl####hhhhhhhhhhz(Nyy|',
    '##[XXQfrfffffff+####hshhhhhhhh)z|ti|',
    '##X]X#ff%%ff%%ff####hhhhhhhhhbhh|t+|',
    '======ff%%ff%%ff####hhh$hhhh$hhhttt|',
    '=jooo=ffffffffff####hhhh----hhhhttt|',
    '=oPooofgggggggagJnnnhhhh---axhhh|st|',
    '=ooioofgggggggggJnnnhhhh----hahh|tt|',
    '=ooor=ffffffffff####hhh$hhhh$hhh|it|',
    '======ff%%ff%%ff####hhhhhhahhhhh|tt|',
    '&&&&&#ff%%ff%%ff####hRhhhhhhhhah|tt|',
    '&aqq&#ffffffffxa####+hhhhhhhhhhh|tb|',
    '&qqa&#%%ffffffff##@#############|tt|',
    '&&DD&#####FF#####&@pUUUUUUUUUUUUUUU@',
    '&wwwwwjwwwwwwwwwww@UUiUUUUUUUUUUU%U@',
    '&wwwwwwwwwwwwwwswwUUUU0000x0000UU%U@',
    '&wwwww%%www%%wwwwwUUUU00a000987UUUU@',
    '&wwwwwwwwwwwwwww+w@UjU000000987UUUU@',
    '&Lwwwwwwwxwwwwwwww@UUU0H0a00000iUUU@',
    '&GGGGGGGGbGGGGG621@UUU000000000UUUU@',
    '&G*GGbGGGGGGGGG621@UbUUUUUUUUUUUaUU@',
    '&GGGGGGGrGGGb+G621@UUUUUUUUUUUUUUUp@',
    '&&&&W&&&&&&&&&&&&&@@@@@@@@@@@@@@@@@@',
  ],
  spots: {
    '^': 'I3',   // scattergun on the office trigger
    '*': 'TA',   // amber key on the gallery trigger
    '(': 'zH', ')': 'zs',
    '[': 'Xv', ']': 'X+', '{': 'Xr',
  },
  legend: {
    '#': wall('w_plate'),
    '=': wall('w_hazard'),
    '%': wall('w_crate'),
    '!': wall('w_grate'),
    '$': wall('w_panel'),
    '|': wall('w_pipes'),
    ':': wall('w_screen'),
    '@': wall('w_rust'),
    '&': wall('w_concrete'),
    'E': { solid: true, wall: 'w_exit_off', exit: true },
    'W': { solid: true, wall: 'w_switch_off', switch: { tag: 3 } },

    'o': { floor: 0, ceil: 1.5, ft: 'f_hazard', ct: 'c_light', wt: 'w_hazard', light: 0.85 },
    'f': bay,
    'g': { ...bay, ct: 'c_light', light: 1 },
    'O': { floor: 0, ceil: 1.5, ft: 'f_plate', ct: 'c_panel', wt: 'w_plate', light: 0.8, door: { tex: 'w_door', key: null, tag: 0, secret: false } },
    'n': { floor: 0, ceil: 1.5, ft: 'f_plate', ct: 'c_panel', wt: 'w_plate', light: 0.8 },
    'e': { floor: 0, ceil: 1.6, ft: 'f_rust', ct: 'c_dark', wt: 'w_grate', light: 0.4 },
    'I': { floor: 0, ceil: 1.6, ft: 'f_rust', ct: 'c_dark', wt: 'w_grate', light: 0.4, trigger: 1 },
    'B': { ...closet, wt: 'w_grate', door: { tex: 'w_grate', key: null, tag: 1, secret: false } },
    'q': closet,
    'Q': { ...bay, ceil: 1.5, door: { tex: 'w_rust', key: null, tag: 0, secret: true } },
    'X': { floor: 0, ceil: 1.5, ft: 'f_plate', ct: 'c_light', wt: 'w_plate', light: 0.7, secret: true },
    'h': hub,
    '-': { ...hub, floor: 0.25, ft: 'f_grate' },
    'z': { ...hub, floor: 0.75, ft: 'f_grate', secret: true },
    'Y': { ...hub, ceil: 2, ft: 'f_hazard', door: { tex: 'w_door_amber', key: 'amber', tag: 0, secret: false } },
    'J': { floor: 0, ceil: 1.5, ft: 'f_plate', ct: 'c_panel', wt: 'w_plate', light: 0.8, door: { tex: 'w_door', key: null, tag: 1, secret: false } },
    'F': { ...bay, ceil: 2, ft: 'f_hazard', door: { tex: 'w_hazard', key: null, tag: 3, secret: false } },
    'm': exitRoom,
    'u': { ...exitRoom, floor: 0.25, ft: 'f_hazard' },
    't': service,
    'y': { ...service, floor: 0.25 },
    'N': { ...service, floor: 0.5, ceil: 2, door: { tex: 'w_rust', key: null, tag: 0, secret: true } },
    'U': freight,
    '7': { ...freight, floor: -0.25, ft: 'f_hazard' },
    '8': { ...freight, floor: -0.5, ft: 'f_hazard' },
    '9': { ...freight, floor: -0.75, ft: 'f_hazard' },
    '0': { ...freight, floor: -1, ft: 'f_rust', light: 0.45 },
    'w': store,
    'G': { ...gallery, floor: 1 },
    'T': { ...gallery, floor: 1, trigger: 2 },
    '1': { ...gallery, floor: 0.25 },
    '2': { ...gallery, floor: 0.5 },
    '6': { ...gallery, floor: 0.75 },
    'L': { ...store, ft: 'f_lift', wt: 'w_hazard', lift: { low: 0, high: 1, tag: 0 } },
    'D': { ...closet, door: { tex: 'w_concrete', key: null, tag: 2, secret: false } },
  },
  tagMessages: {
    1: 'Dock doors unlocked. Something moves behind you.',
    2: 'Storage lockers grind open.',
    3: 'A shutter to the dock bay rolls up.',
  },
};
