// Level 4: Overseer Core. Armoury, a looped approach around a furnace hall, a dark control
// room with the magenta key, then the core arena: raised ring, steps, pillars, three monster
// closets opened by trigger cells, and the overseer. Its death (tag 99) opens the exit hall.

const ARENA_CEIL = 4;

export default {
  id: 'l4',
  name: 'Overseer Core',
  intro: 'The foundry mind waits at the core. Arm up and shut it down.',
  music: 3,
  par: 300,
  playerYaw: -Math.PI / 2,
  tagMessages: {
    2: 'Loader bay shutters grind open.',
    3: 'The east vents are opening.',
    4: 'The south bay is opening.',
    5: 'Behind you: the maintenance bay opens.',
    99: 'The Overseer is down. The exit shutter is open.',
  },
  spots: { '@': 'nM', '$': 'YH' },   // key inside the trigger ring; medkit in the stash corner
  map: [
    '########################################',
    '#boob###################################',
    '#oaao###################################',
    '#T22TTTTTTTTT########IIIIII#############',
    '#nnnnnnSnbnnn########IdIIdI#############',
    '#nnnpninnnttt########IIIIII#############',
    '#ncnnnnnnnt@t########IIIIII#############',
    '#nninnnnpntttNNNFFFF###66###FFFFNNNNN###',
    '#RnnnnHnnnjnnNSKluuuuuuuRuuuuuuuulksN###',
    '#TTTTnnnnTTTTNH(uuuuuuuuuuuuuuuuuu(+NX##',
    '#VYK#mmmm####NuuwwwwwwwwwwwwwwwwwwuuNJJ#',
    '#Yz$#gggg####Nuuwyyyyyyyyy%yyyyyywuuNJJ#',
    '##U##eeee####Nuuwyyyiyyyyy%yyiyyywuuNJj#',
    '#ff,,,,,d,,,KNpuwyyyyyyyyy%yyyyyywuu9JJ#',
    '#Hf,,b,,,,,,,NuuwyyQQyyyyy%QQyyyywuu9JJ#',
    '#ffBBBFFBBB,,NuuwyyQQyyyyy%QQyyyywuuNiJ#',
    '#ffBhh~~hhB,bNuuwyyyyyyyyy%yyyyyywuuNJJ#',
    '#ffBsh~~hhB,,Nuuwyyyyyyyyy%yyyyyywuuNJi#',
    '#ffBhh~~chB,,EquwyyyyxyyZy%yyyyyywuuNJJ#',
    '#ffBhh~~hhB,,Equwyyyyyyyyy%yxyyyywuuN+J#',
    '#bfBhh~~hhB,,Nuuwyyyyyyyyy%yyyyyywuuNJJ#',
    '#ffhhjhhhhh,,Nuuwyyyyyyyyy%yyyyyywupN###',
    '#ffhhhhhjhh,,NuuwyyQQyyyyy%QQyyyywuuN###',
    '#ffBhh~~hhB,,NuuwyyQQyyyyy%QQyyyywuuN###',
    '#ffBhh~~hhB,aNpuwyyyyyyyyy%yyyyyywupNII#',
    '#ffBah~~haB,,Nuuwyyyiyyyyy%yyiyyywuuNcI#',
    '#ffBhh~~hhB,,Nuuwyyyyyyyyy%yyyyyywuu7II#',
    '#ffB+h~~h+Ba,Nuuwwwwwwwwwwwwwwwwwwuu7II#',
    '#ffBhh~~hhB,,N+(uuuuuuuuuuuuuuuuuu(HNIc#',
    '#ffBBBFFBBB,,NsKluuuuuuuvuuuuuuuulKSNcI#',
    '#rf,,,,,,,,,sNNNFFFF###88###FFFFNNNNN###',
    '#ff,,,,,,,,,,########IIIIII#############',
    '#WWWW11WWWW##########IbIIbI#############',
    '#WS3....4sW##########IIbIII#############',
    '#W........W##########IIIIII#############',
    '#W5......VW#############################',
    '#WK..P...RW#############################',
    '#WH......RW#############################',
    '#WWWWWWWWWW#############################',
    '########################################',
  ],
  legend: {
    // walls
    '#': { solid: true, wall: 'w_plate' },
    W: { solid: true, wall: 'w_panel' },
    B: { solid: true, wall: 'w_brick' },
    F: { solid: true, wall: 'w_furnace' },
    T: { solid: true, wall: 'w_screen' },
    N: { solid: true, wall: 'w_concrete' },
    Q: { solid: true, wall: 'w_pipes' },
    X: { solid: true, wall: 'w_exit_off', exit: true },

    // armoury (start)
    '.': { floor: 0, ceil: 2, ft: 'f_plate', ct: 'c_light', wt: 'w_panel', light: 0.85 },
    1: { floor: 0, ceil: 2, ft: 'f_plate', ct: 'c_panel', wt: 'w_panel', light: 0.7, door: { tex: 'w_door', key: null, tag: 0, secret: false } },

    // approach loop: halls, flickering west corridor, furnace hall over a slag channel
    ',': { floor: 0, ceil: 1.5, ft: 'f_grate', ct: 'c_pipes', wt: 'w_plate', light: 0.55 },
    f: { floor: 0, ceil: 1.5, ft: 'f_grate', ct: 'c_pipes', wt: 'w_plate', light: 0.5, flicker: 0.7 },
    h: { floor: 0, ceil: 3, ft: 'f_concrete', ct: 'c_pipes', wt: 'w_brick', light: 0.7 },
    '~': { floor: -0.25, ceil: 3, ft: 'f_slag', ct: 'c_pipes', wt: 'w_brick', light: 0.9, damage: 10 },
    U: { floor: 0, ceil: 1.5, ft: 'f_grate', ct: 'c_pipes', wt: 'w_plate', light: 0.5, door: { tex: 'w_rust', key: null, tag: 0, secret: true } },
    Y: { floor: 0, ceil: 1.5, ft: 'f_rust', ct: 'c_dark', wt: 'w_rust', light: 0.35 },
    z: { floor: 0, ceil: 1.5, ft: 'f_rust', ct: 'c_dark', wt: 'w_rust', light: 0.35, secret: true },

    // stairs up to the dark control room
    e: { floor: 0.25, ceil: 2.5, ft: 'f_plate', ct: 'c_dark', wt: 'w_hazard', light: 0.5 },
    g: { floor: 0.5, ceil: 2.5, ft: 'f_plate', ct: 'c_dark', wt: 'w_hazard', light: 0.45 },
    m: { floor: 0.75, ceil: 2.5, ft: 'f_plate', ct: 'c_dark', wt: 'w_hazard', light: 0.4 },
    n: { floor: 1, ceil: 2.5, ft: 'f_rust', ct: 'c_dark', wt: 'w_screen', light: 0.35 },
    t: { floor: 1, ceil: 2.5, ft: 'f_rust', ct: 'c_dark', wt: 'w_screen', light: 0.35, trigger: 5 },
    o: { floor: 1, ceil: 2.5, ft: 'f_rust', ct: 'c_dark', wt: 'w_plate', light: 0.2 },
    2: { floor: 1, ceil: 2.5, ft: 'f_rust', ct: 'c_dark', wt: 'w_screen', light: 0.3, door: { tex: 'w_grate', key: null, tag: 5, secret: false } },

    // core arena
    E: { floor: 0.25, ceil: 2.25, ft: 'f_hazard', ct: 'c_panel', wt: 'w_concrete', light: 0.7, door: { tex: 'w_door_magenta', key: 'magenta', tag: 0, secret: false } },
    u: { floor: 0.5, ceil: ARENA_CEIL, ft: 'f_grate', ct: 'c_light', wt: 'w_hazard', light: 0.95 },
    q: { floor: 0.5, ceil: ARENA_CEIL, ft: 'f_grate', ct: 'c_light', wt: 'w_hazard', light: 0.95, trigger: 2 },
    w: { floor: 0.25, ceil: ARENA_CEIL, ft: 'f_hazard', ct: 'c_panel', wt: 'w_hazard', light: 0.9 },
    y: { floor: 0, ceil: ARENA_CEIL, ft: 'f_plate', ct: 'c_panel', wt: 'w_hazard', light: 0.9 },
    '%': { floor: 0, ceil: ARENA_CEIL, ft: 'f_plate', ct: 'c_panel', wt: 'w_hazard', light: 0.9, trigger: 3 },
    '(': { floor: 0.5, ceil: ARENA_CEIL, ft: 'f_grate', ct: 'c_light', wt: 'w_hazard', light: 0.95, trigger: 4 },
    I: { floor: 0.5, ceil: 2.5, ft: 'f_rust', ct: 'c_dark', wt: 'w_plate', light: 0.3 },
    6: { floor: 0.5, ceil: 2.5, ft: 'f_hazard', ct: 'c_dark', wt: 'w_concrete', light: 0.6, door: { tex: 'w_grate', key: null, tag: 2, secret: false } },
    7: { floor: 0.5, ceil: 2.5, ft: 'f_hazard', ct: 'c_dark', wt: 'w_concrete', light: 0.6, door: { tex: 'w_grate', key: null, tag: 3, secret: false } },
    8: { floor: 0.5, ceil: 2.5, ft: 'f_hazard', ct: 'c_dark', wt: 'w_concrete', light: 0.6, door: { tex: 'w_grate', key: null, tag: 4, secret: false } },

    // exit hall
    9: { floor: 0.5, ceil: 2.5, ft: 'f_hazard', ct: 'c_panel', wt: 'w_concrete', light: 0.7, door: { tex: 'w_door', key: null, tag: 99, secret: false } },
    J: { floor: 0.5, ceil: 2, ft: 'f_hazard', ct: 'c_light', wt: 'w_panel', light: 0.6, flicker: 0.4 },
  },
};
