// Level 2: Smelter Line. Authoring format in build.js.
//
// Start lockers (SW) -> slag walk, a spitter on a balcony across the channel -> casting bay
// (bolt driver; picking it up opens the holding bay and the tag-1 pump doors back to the
// lockers and into the pipe maze) -> pour hall hub, cut by a slag channel with catwalks. The
// cyan key sits at the end of the ladle gantry above the hall's east slag pit; the cyan door
// is on the landing across the pit catwalk. Route up: furnace hall (platform lift to the
// gallery) or the hall's north door, through the dark pipe maze to the control room; from its
// mezzanine the shaft switch raises the freight lift level with the gantry. Drop to the
// landing, cyan door, tapping floor, exit.
// Slag sits 0.25 below the walkways, so a player who falls in can always step out.
// Secrets: a rusted panel in the lockers' east wall (the spitter's balcony goods), and a rust
// panel among the pipes in the maze's lower corridor.

const wall = (wall) => ({ solid: true, wall });
const slag = { floor: -0.25, ceil: 3, ft: 'f_slag', ct: 'c_dark', wt: 'w_rust', light: 1, damage: 20 };
const lockers = { floor: 0, ceil: 2, ft: 'f_concrete', ct: 'c_light', wt: 'w_concrete', light: 0.8 };
const walk = { floor: 0, ceil: 2.5, ft: 'f_rust', ct: 'c_pipes', wt: 'w_rust', light: 0.6 };
const balcony = { floor: 0.6, ceil: 2.5, ft: 'f_plate', ct: 'c_pipes', wt: 'w_hazard', light: 0.7 };
const bay = { floor: 0, ceil: 2.5, ft: 'f_concrete', ct: 'c_panel', wt: 'w_plate', light: 0.55 };
const closet = { floor: 0, ceil: 2, ft: 'f_rust', ct: 'c_dark', wt: 'w_rust', light: 0.3 };
const hall = { floor: 0, ceil: 3, ft: 'f_plate', ct: 'c_pipes', wt: 'w_plate', light: 0.85 };
const catwalk = { floor: 0, ceil: 3, ft: 'f_grate', ct: 'c_dark', wt: 'w_grate', light: 0.9 };
const furnace = { floor: 0, ceil: 3, ft: 'f_concrete', ct: 'c_dark', wt: 'w_brick', light: 0.6 };
const gallery = { floor: 1.5, ceil: 3, ft: 'f_grate', ct: 'c_dark', wt: 'w_brick', light: 0.5 };
const maze = { floor: 0, ceil: 1.75, ft: 'f_grate', ct: 'c_pipes', wt: 'w_pipes', light: 0.3, flicker: 0.6 };
const step = (floor) => ({ floor, ceil: 3, ft: 'f_grate', ct: 'c_pipes', wt: 'w_hazard', light: 0.35 });
const control = { floor: 0.25, ceil: 2.5, ft: 'f_plate', ct: 'c_light', wt: 'w_panel', light: 0.8 };
const ledge = { floor: 1.5, ceil: 3, ft: 'f_plate', ct: 'c_dark', wt: 'w_rust', light: 0.75 };
const landing = { floor: 0, ceil: 3, ft: 'f_plate', ct: 'c_dark', wt: 'w_plate', light: 0.7 };
const tapping = { floor: 0, ceil: 2.5, ft: 'f_concrete', ct: 'c_light', wt: 'w_hazard', light: 0.7 };
const door = (base, tex, extra = {}) => ({ ...base, door: { tex, key: null, tag: 0, secret: false, ...extra } });

export default {
  id: 'l2',
  name: 'Smelter Line',
  intro: 'The pour lines are still running. Nobody is minding them.',
  music: 1,
  par: 240,
  playerYaw: -Math.PI / 2,
  map: [
    'BBFFBFFBFFBBBBIIIIIIIIIIIIIINQQQNQQQNQQQNQQN',
    'Bf~~~~~~~~fuuBIIIII:::::a:::N*************pN',
    'Bf~~~~~~~~fucBIIIII:::::::::N**************N',
    'Bffffffffffuug87621::i;;II::N**b*******b***N',
    'Bxfffffffffuug87621::I;;IIi:N****NNNN******N',
    'BfffFFFfffpuuBIIIII::Ib;II::Nj***NNNN******N',
    'BfffaFFffffuuBIIIII:iI;;II::N**************N',
    'BffffffffffuuB::a:::::::i:::N**************N',
    'BfffffafffmuuB:i::::::::::::n******c**HXXXXN',
    'BffbffffffmuuBIII|I:rIIIII:an*r****^<>XXXXXN',
    'Bsrffffffffu+BvR;&I::IIIII::N******^<>XXXXXN',
    'BBBBBBnnBBBBBBIIIII@@IIIIIIINNNNNNNNNNNNLLWN',
    'U............................x.~~hhhahhhhhhU',
    'U........x.UU.s..........UU....~~Chhhhhhhh+U',
    'U........b.UU..........b.UU....~~~~~~~~bhhhU',
    'U.......................x......~~~~~~~~hhTTU',
    'U,,,,,l,,l,,,,,,,,,l,,l,,,,,,,,~~~~~~~~hhTTU',
    'U~~~~~~==~~~~~~~~~~~==~~~~~~~~~~~~~~~~~hhhhU',
    'U~~~~~~==~~~~~~~~~~~==~~~~~~~~~~~~~~~~~hahsU',
    'U,,,,,l,,l,,,,,,,,,l,,l,,,,,,,,~~~~~~~~hhhhU',
    'U...........................c..~~----------U',
    'U..........UU..a.a.......UU....==----------U',
    'U.H........UU+...........UU..r.==---------rU',
    'U..............................~~----------U',
    'UUUUUooUUUUUUUUUUUUUUUUUUqqUUU#######JJ####U',
    'OOOOO@@OOOOUUUUUUUUUUUU##nn####eeeeeeeeeeee#',
    'OOoooooooxOwwwwwwwwwwwURqqqqqx#+eeeeeeeeeee#',
    'OOo3ssoorowwwwwwwwwwwwwqqqqqbq#eeceeeeeebee#',
    'OOoooooooowwwwwwwwwwwwwqqqqqq+#eeeeleeleeee#',
    'OOooooooooO~~~~~~~~~~~Uqqq!qqq#~~~~~==~~~~~#',
    'OOoooooTToO~~~~~~~~~~~Uqbqqqqq#~~~~~==~~~~~#',
    'OOoooooTToO~~~~~~~~~~~Ujqqqqqp#eeeeleeleeee#',
    'OOooooooooOyyyyyyyyyyyU#DDDDD##ebeeeeeeeeae#',
    'OOoPoooooo/$yHyycyyyvyUzzzzzzz#eee0000000ee#',
    'OOoooooo+oOyyyyyyyySyyUazazazb#eee9999999ee#',
    'OOjoooooooOUUUUUUUUUUUUzzzczzz#eee(((c(((ee#',
    'OOOOOOOOOOOUUUUUUUUUUUU########eee(((((((ee#',
    'OOOOOOOOOOOUUUUUUUUUUUU##########YYYYEEYYY##',
  ],
  spots: {
    '!': 't4',
  },
  legend: {
    '#': wall('w_plate'),
    'O': wall('w_concrete'),
    'U': wall('w_rust'),
    'B': wall('w_brick'),
    'F': wall('w_furnace'),
    'I': wall('w_pipes'),
    'Q': wall('w_screen'),
    'N': wall('w_panel'),
    'Y': wall('w_hazard'),
    'T': wall('w_crate'),
    'W': { solid: true, wall: 'w_switch_off', switch: { tag: 2 } },
    'E': { solid: true, wall: 'w_exit_off', exit: true },
    '~': slag,
    'o': lockers,
    '/': door({ ...lockers, floor: 0.3, light: 0.5 }, 'w_rust', { secret: true }),
    'w': walk,
    'y': balcony,
    '$': { ...balcony, secret: true },
    'q': bay,
    't': { ...bay, trigger: 1 },
    'z': closet,
    'D': door(closet, 'w_hazard', { tag: 1 }),
    'n': door({ ...bay, ceil: 2, light: 0.6 }, 'w_door'),
    '.': hall,
    ',': { ...hall, light: 1 },
    '@': door({ ...bay, ceil: 2, light: 0.6 }, 'w_door', { tag: 1 }),
    '=': catwalk,
    'f': furnace,
    'u': gallery,
    'm': { ...furnace, ft: 'f_lift', wt: 'w_hazard', lift: { low: 0, high: 1.5, tag: 0 } },
    'g': door({ ...gallery, ceil: 2.75 }, 'w_door'),
    ':': maze,
    ';': { ...maze, light: 0.2, flicker: 0 },
    '|': door(maze, 'w_rust', { secret: true }),
    '&': { ...maze, light: 0.25, flicker: 0, secret: true },
    '1': step(0.25),
    '2': step(0.5),
    '6': step(0.75),
    '7': step(1),
    '8': step(1.25),
    '*': control,
    'X': { ...control, floor: 1.25, ceil: 3, wt: 'w_hazard' },
    '^': { ...control, floor: 0.5, ceil: 3, wt: 'w_hazard' },
    '<': { ...control, floor: 0.75, ceil: 3, wt: 'w_hazard' },
    '>': { ...control, floor: 1, ceil: 3, wt: 'w_hazard' },
    'L': { ...control, floor: 0, ceil: 3, ft: 'f_lift', wt: 'w_hazard', lift: { low: 0, high: 1.5, tag: 2 } },
    'h': ledge,
    '-': landing,
    'J': door({ ...landing, ceil: 2 }, 'w_door_cyan', { key: 'cyan' }),
    'e': tapping,
    '0': { ...tapping, floor: 0.25, light: 0.8 },
    '9': { ...tapping, floor: 0.5, light: 0.85 },
    '(': { ...tapping, floor: 0.75, light: 0.9 },
  },
  tagMessages: {
    1: 'Holding bay unsealed. Pump doors released.',
    2: 'Freight lift engaged.',
  },
};
