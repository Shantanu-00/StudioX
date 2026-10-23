import {EpisodeAnalysis, validateAnalysis} from './schema';

// Hand-authored analysis for the two demo episodes, written from the episode
// scripts in media/use.md in the exact shape the agent pipeline will emit.
// `provenance: 'demo-fixture'` is shown on screen until the pipeline output
// replaces it. Verdicts here are editorial readings of the script, and the
// answers cite only episode timestamps (no web sources are claimed).
// Outside facts carry their source; episode facts carry evidence.

const science: EpisodeAnalysis = {
  mediaId: 'science-ep42',
  provenance: 'demo-fixture',
  transcript: [
    {
      t0: 0,
      t1: 3,
      speaker: 'DR. JULIAN',
      text: 'Look at how Cristiano Ronaldo optimizes his recovery.',
    },
    {t0: 3, t1: 5, speaker: 'ELENA', text: 'Right, the R90 polyphasic cycles?'},
    {
      t0: 5,
      t1: 8,
      speaker: 'DR. JULIAN',
      text: 'Exactly. Five ninety-minute cycles.',
    },
    {
      t0: 8,
      t1: 11,
      speaker: 'DR. JULIAN',
      text: 'Harvard clinical data shows midday sleep cuts cardiovascular strain by 37 percent.',
    },
    {
      t0: 11,
      t1: 13,
      speaker: 'ELENA',
      text: 'And what was the compound stack?',
    },
    {
      t0: 13,
      t1: 19,
      speaker: 'DR. JULIAN',
      text: 'Clinical protocols pair 145 milligrams of Magnesium L-Threonate with 50 milligrams of Apigenin.',
    },
    {
      t0: 19,
      t1: 26,
      speaker: 'DR. JULIAN',
      text: 'Threonate crosses the blood-brain barrier to deepen slow-wave sleep, while Apigenin quiets neuro-chatter.',
    },
    {
      t0: 26,
      t1: 33,
      speaker: 'DR. JULIAN',
      text: 'Kept at 18 degrees Celsius, delta waves surge.',
    },
    {t0: 33, t1: 34, speaker: 'ELENA', text: 'It completely stabilizes it.'},
    {
      t0: 34,
      t1: 37.28,
      speaker: 'DR. JULIAN',
      text: 'Within seven days, your sleep architecture completely transforms.',
    },
  ],
  segments: [
    {
      id: 's1',
      start: 0,
      end: 11,
      title: 'R90 recovery cycles',
      genre: 'health',
    },
    {
      id: 's2',
      start: 11,
      end: 33,
      title: 'The compound stack',
      genre: 'science',
    },
    {
      id: 's3',
      start: 33,
      end: 37.28,
      title: 'Sleep architecture',
      genre: 'health',
    },
  ],
  moments: [
    {t: 0, caption: 'Dr. Julian uses Cristiano Ronaldo as the example.'},
    {t: 5, caption: 'A claim: midday sleep cuts cardiovascular strain by 37%.'},
    {t: 13, caption: 'The guest names a two-compound evening stack.'},
    {t: 26, caption: 'Room temperature is the last part of the routine.'},
    {t: 34, caption: 'The promised result: changed sleep within seven days.'},
  ],
  widgets: [
    {
      id: 'ronaldo',
      type: 'dossier',
      name: 'Cristiano Ronaldo',
      role: 'Footballer · cited as the example',
      evidence: [{t0: 0, t1: 3}],
      facts: [
        {
          text: 'Named as someone who "optimizes his recovery".',
          evidence: {t0: 0, t1: 3},
        },
        {
          text: 'Has worked with sleep coach Nick Littlehales, who devised the R90 method.',
          source: 'N. Littlehales, Sleep (2016)',
        },
      ],
    },
    {
      id: 'r90',
      type: 'technique',
      title: 'R90: five 90-minute cycles',
      shape: 'bars',
      phases: [
        {label: 'Cycle 1', seconds: 5400},
        {label: 'Cycle 2', seconds: 5400},
        {label: 'Cycle 3', seconds: 5400},
        {label: 'Cycle 4', seconds: 5400},
        {label: 'Cycle 5', seconds: 5400},
      ],
      caption: '5 × 90 min = 7 h 30 min. Shown at 1 s per 15 min.',
      evidence: [{t0: 5, t1: 8}],
    },
    {
      id: 'siesta-claim',
      type: 'claim',
      claim: 'Midday sleep cuts cardiovascular strain by 37 percent.',
      speaker: 'Dr. Julian, citing "Harvard clinical data"',
      context:
        'Likely refers to Naska et al. (2007): among 23,681 Greek adults, regular siestas were associated with 37% lower coronary mortality. It was observational and measured deaths, not "strain".',
      source: 'Arch Intern Med 2007;167(3):296–301',
      verdict: 'NUANCED',
      evidence: [{t0: 5, t1: 11}],
    },
    {
      id: 'compounds',
      type: 'entity_list',
      title: 'Compounds mentioned',
      kind: 'compound',
      items: [
        {
          name: 'Magnesium L-threonate',
          dose: '145 mg',
          asSaid:
            '"Crosses the blood–brain barrier to deepen slow-wave sleep."',
          evidence: {t0: 13, t1: 22},
        },
        {
          name: 'Apigenin',
          dose: '50 mg',
          asSaid: '"Quiets neuro-chatter."',
          evidence: {t0: 17, t1: 26},
        },
      ],
      disclaimer: 'Mentioned in the episode. Not medical advice.',
      evidence: [{t0: 13, t1: 26}],
    },
    {
      id: 'evening',
      type: 'protocol',
      title: 'Evening routine, as described',
      steps: [
        {
          label: 'Magnesium L-threonate',
          detail: '145 mg in the evening',
          evidence: {t0: 13, t1: 19},
        },
        {
          label: 'Apigenin',
          detail: '50 mg alongside it',
          evidence: {t0: 17, t1: 22},
        },
        {
          label: 'Cool the room',
          detail: 'Bedroom kept at 18 °C',
          evidence: {t0: 26, t1: 33},
        },
        {
          label: 'Plan the night',
          detail: 'Five 90-minute cycles',
          evidence: {t0: 5, t1: 8},
        },
      ],
      disclaimer: 'As stated by the guest. Not medical advice.',
      evidence: [{t0: 13, t1: 33}],
    },
  ],
  answers: [
    {
      question: 'What is the R90 method?',
      t: 5,
      text: 'A sleep-planning method from sleep coach Nick Littlehales: plan the night as 90-minute cycles. The guest says five of them [0:05], which is 7 h 30 min.',
      cites: [5],
      sources: [],
    },
    {
      question: 'Is the 37% from a real study?',
      t: 11,
      text: 'Probably Naska et al. (2007): among 23,681 Greek adults, regular siestas went with 37% lower coronary mortality [0:08]. It was observational and counted deaths, not “strain”, so it does not show the nap caused it.',
      cites: [8],
      sources: [],
    },
    {
      question: 'What does magnesium L-threonate do?',
      t: 19,
      text: 'The guest says it crosses the blood–brain barrier to deepen slow-wave sleep [0:19], taken as 145 mg with 50 mg of apigenin [0:13]. That is his claim in the episode, not medical advice.',
      cites: [19, 13],
      sources: [],
    },
  ],
};

const crime: EpisodeAnalysis = {
  mediaId: 'crime-case104',
  provenance: 'demo-fixture',
  transcript: [
    {
      t0: 0,
      t1: 8,
      speaker: 'NARRATOR',
      text: 'In his recorded interview, suspect Marcus Vance swore under oath he never left the Westside Diner between 9:30 and 11:00 PM.',
    },
    {
      t0: 8,
      t1: 14,
      speaker: 'NARRATOR',
      text: 'But cellular dump records from Tower 4 reveal his phone pinged right here at Pier 9 at 10:14 PM,',
    },
    {
      t0: 14,
      t1: 18.3,
      speaker: 'NARRATOR',
      text: 'six minutes before his cracked burner phone hit the pavement.',
    },
    {
      t0: 18.3,
      t1: 30,
      speaker: 'NARRATOR',
      text: 'Which places Vance directly on the pier moments before the harbour security cameras were deliberately severed.',
    },
    {
      t0: 30,
      t1: 37.28,
      speaker: 'NARRATOR',
      text: 'And what detectives uncovered inside his waterfront locker at midnight changes the motive entirely.',
    },
  ],
  segments: [
    {id: 'c1', start: 0, end: 8, title: 'The alibi', genre: 'crime'},
    {id: 'c2', start: 8, end: 18.3, title: 'Tower 4 ping', genre: 'crime'},
    {id: 'c3', start: 18.3, end: 30, title: 'Pier 9 cameras', genre: 'crime'},
    {id: 'c4', start: 30, end: 37.28, title: 'The locker', genre: 'crime'},
  ],
  moments: [
    {t: 0, caption: 'Marcus Vance states his alibi under oath.'},
    {t: 8, caption: 'Phone records contradict the alibi.'},
    {t: 14, caption: 'His burner phone hits the pavement at Pier 9.'},
    {t: 20, caption: 'The harbour cameras were cut moments later.'},
    {t: 30, caption: 'A locker search changes the motive.'},
  ],
  widgets: [
    {
      id: 'vance',
      type: 'dossier',
      name: 'Marcus Vance',
      role: 'Suspect · logistics manager',
      evidence: [{t0: 0, t1: 8}],
      facts: [
        {
          text: 'Swore he never left the Westside Diner, 9:30–11:00 PM.',
          evidence: {t0: 0, t1: 8},
        },
        {
          text: 'His phone pinged Tower 4 at Pier 9 at 10:14 PM.',
          evidence: {t0: 8, t1: 14},
        },
      ],
    },
    {
      id: 'chronology',
      type: 'timeline',
      title: 'Incident chronology',
      evidence: [{t0: 0, t1: 37}],
      events: [
        {
          id: 'e1',
          when: '9:30 PM',
          label: 'Claimed: arrives at Westside Diner',
          kind: 'claim',
          evidence: {t0: 0, t1: 8},
        },
        {
          id: 'e2',
          when: '10:14 PM',
          label: 'Phone pings Tower 4 at Pier 9',
          kind: 'conflict',
          evidence: {t0: 8, t1: 14},
        },
        {
          id: 'e3',
          when: '10:20 PM',
          label: 'Burner phone hits the pavement',
          kind: 'fact',
          evidence: {t0: 12, t1: 18},
        },
        {
          id: 'e4',
          when: '~10:20 PM',
          label: 'Harbour cameras deliberately severed',
          kind: 'fact',
          evidence: {t0: 20, t1: 30},
        },
        {
          id: 'e5',
          when: '12:00 AM',
          label: 'Detectives open his waterfront locker',
          kind: 'fact',
          evidence: {t0: 30, t1: 37},
        },
      ],
    },
    {
      id: 'links',
      type: 'relation_graph',
      title: 'Who and where',
      evidence: [{t0: 0, t1: 30}],
      nodes: [
        {id: 'vance', label: 'Marcus Vance', kind: 'person', x: 0.5, y: 0.45},
        {id: 'diner', label: 'Westside Diner', kind: 'place', x: 0.1, y: 0.1},
        {id: 'pier', label: 'Pier 9', kind: 'place', x: 0.9, y: 0.1},
        {id: 'burner', label: 'Burner phone', kind: 'object', x: 0.9, y: 0.85},
        {
          id: 'locker',
          label: 'Waterfront locker',
          kind: 'object',
          x: 0.1,
          y: 0.85,
        },
      ],
      edges: [
        {from: 'vance', to: 'diner', label: 'claimed alibi'},
        {from: 'vance', to: 'pier', label: 'ping 10:14 PM', conflict: true},
        {from: 'vance', to: 'burner', label: 'his phone'},
        {from: 'vance', to: 'locker', label: 'his locker'},
      ],
    },
    {
      id: 'alibi-claim',
      type: 'claim',
      claim: 'Never left the Westside Diner between 9:30 and 11:00 PM.',
      speaker: 'Marcus Vance, recorded interview',
      context:
        'Cell records from Tower 4 place his phone at Pier 9 at 10:14 PM.',
      counter: 'A phone ping places the phone, not necessarily the person.',
      verdict: 'DISPUTED',
      evidence: [{t0: 0, t1: 14}],
    },
  ],
  answers: [
    {
      question: 'Does the ping prove he was at the pier?',
      t: 10,
      text: 'No. A tower ping places his phone near Tower 4 at 10:14 PM [0:08], not the man himself. It does contradict the alibi he swore to [0:00].',
      cites: [8, 0],
      sources: [],
    },
    {
      question: 'When were the cameras cut?',
      t: 20,
      text: 'Moments after his burner phone hit the pavement, around 10:20 PM [0:14]. The narrator says the cameras were cut deliberately [0:18].',
      cites: [14, 18],
      sources: [],
    },
  ],
};

export const ANALYSES: Record<string, EpisodeAnalysis> = {
  [science.mediaId]: validateAnalysis(science),
  [crime.mediaId]: validateAnalysis(crime),
};
