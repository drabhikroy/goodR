// British spellings the gate rejects, mapped to their American forms.
//
// Verbs ending in -ise and -yse are listed once as stems and expanded to
// every inflection below, so "organise" also catches "organised",
// "organises", "organising", and "organisation".

const IRREGULAR = {
  colour: "color", colours: "colors", coloured: "colored", colouring: "coloring", colourful: "colorful",
  behaviour: "behavior", behaviours: "behaviors", behavioural: "behavioral",
  favour: "favor", favours: "favors", favourite: "favorite", favourites: "favorites", favourable: "favorable",
  honour: "honor", humour: "humor", labour: "labor", neighbour: "neighbor", neighbours: "neighbors",
  rumour: "rumor", vapour: "vapor", flavour: "flavor", harbour: "harbor", endeavour: "endeavor",
  centre: "center", centres: "centers", centred: "centered", metre: "meter", metres: "meters",
  litre: "liter", fibre: "fiber", theatre: "theater", calibre: "caliber", spectre: "specter",
  grey: "gray", greys: "grays", greyed: "grayed", greyscale: "grayscale",
  catalogue: "catalog", catalogues: "catalogs", dialogue: "dialog", analogue: "analog",
  licence: "license", licences: "licenses", defence: "defense", offence: "offense", pretence: "pretense",
  travelled: "traveled", travelling: "traveling", traveller: "traveler",
  cancelled: "canceled", cancelling: "canceling", labelled: "labeled", labelling: "labeling",
  modelled: "modeled", modelling: "modeling", modeller: "modeler",
  levelled: "leveled", levelling: "leveling", signalled: "signaled", signalling: "signaling",
  totalled: "totaled", totalling: "totaling", fuelled: "fueled", fuelling: "fueling",
  marshalled: "marshaled", channelled: "channeled", tunnelled: "tunneled", counselled: "counseled",
  enrol: "enroll", enrolment: "enrollment", fulfil: "fulfill", fulfilment: "fulfillment",
  instil: "instill", skilful: "skillful", wilful: "willful",
  programme: "program", programmes: "programs", artefact: "artifact", artefacts: "artifacts",
  judgement: "judgment", acknowledgement: "acknowledgment", ageing: "aging",
  aluminium: "aluminum", cheque: "check", kerb: "curb", tyre: "tire", plough: "plow",
  mould: "mold", moult: "molt", smoulder: "smolder", draught: "draft", manoeuvre: "maneuver",
  paediatric: "pediatric", anaemia: "anemia", oestrogen: "estrogen", foetus: "fetus",
  encyclopaedia: "encyclopedia", orthopaedic: "orthopedic", haemoglobin: "hemoglobin",
  sceptical: "skeptical", sceptic: "skeptic", whilst: "while", amongst: "among",
  towards: "toward", afterwards: "afterward", backwards: "backward", forwards: "forward",
  learnt: "learned", spelt: "spelled", dreamt: "dreamed", burnt: "burned",
  focussed: "focused", focussing: "focusing", benefitted: "benefited",
  practise: "practice", practised: "practiced", practising: "practicing",
  storey: "story", storeys: "stories", jewellery: "jewelry", pyjamas: "pajamas",
  speciality: "specialty", specialities: "specialties", connexion: "connection",
};

const ISE_STEMS = [
  "organis", "recognis", "realis", "summaris", "visualis", "normalis", "optimis", "initialis",
  "serialis", "standardis", "categoris", "prioritis", "customis", "minimis", "maximis",
  "authoris", "characteris", "emphasis", "finalis", "generalis", "localis", "memoris",
  "modernis", "parameteris", "personalis", "randomis", "specialis", "stabilis", "synchronis",
  "tokenis", "utilis", "apologis", "criticis", "harmonis", "itemis", "mobilis", "neutralis",
  "penalis", "rationalis", "sanitis", "symbolis", "theoris", "vectoris", "capitalis",
];

const YSE_STEMS = ["analys", "paralys", "catalys"];

// Each stem ends in "is" or "ys". The American form swaps the final s for z.
function expand(stems) {
  const out = {};
  for (const british of stems) {
    const american = british.slice(0, -1) + "z";
    for (const suffix of ["e", "es", "ed", "ing", "er", "ers", "ation", "ations"]) {
      out[british + suffix] = american + suffix;
    }
  }
  return out;
}

// "emphasis" and "analysis" are correct American nouns, so the noun forms
// that expansion would wrongly flag are removed again.
const NOT_BRITISH = ["emphasis", "analysis", "analyses", "paralysis", "catalysis"];

const map = { ...IRREGULAR, ...expand(ISE_STEMS), ...expand(YSE_STEMS) };
for (const word of NOT_BRITISH) delete map[word];

export const BRITISH = new Map(Object.entries(map));
