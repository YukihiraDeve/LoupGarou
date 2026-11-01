// French bot names and lines.
export const BOT_NAMES = [
  'Camille', 'Lucas', 'Léa', 'Hugo', 'Chloé', 'Louis', 'Manon', 'Gabriel', 'Inès', 'Jules',
  'Zoé', 'Arthur', 'Jade', 'Nathan', 'Lina', 'Raphaël', 'Louise', 'Adam', 'Ambre', 'Théo',
  'Margaux', 'Paul', 'Clémence', 'Victor', 'Juliette', 'Maxime', 'Élise', 'Antoine', 'Romane',
  'Baptiste', 'Mathilde', 'Simon', 'Capucine', 'Étienne', 'Agathe', 'Martin', 'Noémie', 'Gaspard',
  'Héloïse', 'Bastien', 'Odile', 'Firmin', 'Rose', 'Marius', 'Apolline', 'Basile',
];

export const LINES = {
  greet: [
    'Salut tout le monde !', 'Bonsoir le camp !', 'Prêts pour une partie ?', 'Coucou ! On se pose autour du feu ?',
    'Qui a apporté les chamallows ?',
  ],
  debate: [
    'Bon, qui a quelque chose à dire ?', 'Je suis simple villageois, je vous le jure.',
    "Cette nuit j'ai cru entendre des pas près de ma tente…", 'On ne va pas voter au hasard quand même !',
    'Je vous ai à l\'œil, tous.', 'Ça sent le loup par ici.', 'Quelqu\'un a une piste sérieuse ?',
    'Restons calmes et réfléchissons.', 'Je ne dirai rien de plus pour l\'instant.',
  ],
  accuse: [
    '{name}, tu es bien silencieux aujourd\'hui…', 'Je ne sens pas {name}, franchement.',
    'Moi je vote {name}, trop louche.', '{name}, pourquoi tu regardes tes pieds ?',
    'Hier soir {name} s\'est couché bien tard…', 'Et si c\'était {name} ?',
  ],
  mourn: ['Pauvre {name}…', 'Repose en paix, {name}.', 'Qui pouvait en vouloir à {name} ?', 'Quelle nuit horrible…'],
  seerClaim: ["J'ai vu {name} cette nuit : c'est un loup !", 'Je suis la Voyante. {name} est un Loup-Garou, votez-le !'],
  defend: [
    'Moi ? Mais je suis innocent, voyons !', 'N\'importe quoi, {name} cherche à détourner l\'attention.',
    'Vous faites fausse route.', '{name}, tu te trompes de cible.', 'Je n\'ai rien à me reprocher.',
  ],
  election: ['Je me présente comme Capitaine !', 'Votez pour moi, je serai juste.', 'Il nous faut un Capitaine qui écoute.'],
  wolves: ['On mange {name} ?', 'Je propose {name}.', 'Va pour {name}.', 'Méfiez-vous, la Petite Fille rôde…', '{name}, ce soir.'],
  dead: ['Bon, au moins on voit tout d\'ici.', 'Je le savais !', 'Allez le village…', 'Ils sont tellement à côté…'],
  over: ['Bien joué tout le monde !', 'GG !', 'Je le savais !', 'On en refait une ?', 'Quelle partie !'],
};

export function fill(line, vars = {}) {
  return line.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
