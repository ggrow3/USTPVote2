import { lessonsOf, question, type SeededCourse } from './lessons.js';

const COURSE_ID = 'introduction-to-left-transhumanism';
const lesson = lessonsOf(COURSE_ID);

/**
 * Introduction to Left Transhumanism 101 to 501 and the USTP-Left, from the party's curriculum: a new course after
 * The Fundamental Questions of Transhumanism. The USTP-Left's conduct rules, written for its own forum category, are
 * left out of this public course (the user's choice, 2026-11-01).
 */
export const introductionToLeftTranshumanism: SeededCourse = {
  courseId: COURSE_ID,
  title: 'Introduction to Left Transhumanism',
  summary:
    'Introduction to Left Transhumanism 101 to 501 and the USTP-Left: its aims, ideologies and allies, and its positions on Luddism, Solarpunk, Malthusianism, bodily autonomy, disability and aging.',
  placement: { prerequisites: ['fundamental-questions'], position: { row: 1, column: 4 } },
  lessons: [
    lesson(
      'left-101',
      1,
      '101: What Left Transhumanism is',
      'Why Left Transhumanism was formed, why it adds “Left”, its objectives, the problems it faces, and where it goes from here.',
      10,
      [
        [
          'Introduction',
          'Left Transhumanism represents a distinct perspective within the broader Transhumanist community. It was initially formed to create a space where leftists could engage with transhumanist ideas outside of the prevailing libertarian and anti-communist tendencies of the wider transhumanist community. Over time, this current has expanded, generating a growing demand for a theoretical line, shared aims, and strategic direction.',
        ],
        [
          'Why Add “Left” to Transhumanism?',
          'Standard transhumanism often ignores who owns the technology. Left Transhumanism merges scientific optimism with a critique of capitalism: it argues that technological tools cannot remain private corporate monopolies. If high-tech breakthroughs are distributed through market competition, they become luxury goods for the rich. Left Transhumanism demands that all transformative technology be democratized, open-source, and guaranteed as shared human infrastructure.',
        ],
        [
          'Objectives & Goals',
          'The objectives of Left Transhumanism are to:',
          '• Trace the left-wing roots of proto-transhumanist movements such as Russian Cosmism and Biocosmism',
          '• Turn other left leaning individuals into Transhumanists or, at the very least, ‘Pro-Tech’',
          '• Organize leftists within the pro-technological and transhumanist spaces',
          '• Influence the Transhumanist community to be more of a left wing community',
        ],
        [
          'Problems & Issues',
          'Left Transhumanism seeks to resolve several structural challenges:',
          '• The popular perception of transhumanism as an exclusively libertarian or billionaire-driven ideology',
          '• The historical concentration of right-wing venture capital influence (e.g., Peter Thiel and Silicon Valley libertarianism) in longevity and tech advocacy during the early 2000s and 2010s with its ideological impacts',
          '• The understudied history of radical left-wing contributions to cybernetics, life extension, and space exploration',
        ],
        [
          'Going Forward',
          'As transhumanism becomes an increasingly relevant topic in the 21st century, defining its scope and purpose is critical. Countering perceptions of elitism requires active organizing, accessible education, and popular movement-building. For Left Transhumanism, the focus remains on ensuring that the tools of human liberation ranging from biogerontology to cybernetic planning are organized as common public goods rather than private commodities.',
        ],
      ],
      [
        question('l1-1', 'Why was Left Transhumanism initially formed?', ['To oppose all technology', 'To give leftists a space to engage with transhumanist ideas outside the prevailing libertarian and anti-communist tendencies', 'To replace the Transhumanist Party', 'To sell longevity treatments'], 1, 'It was initially formed to create a space where leftists could engage with transhumanist ideas outside of the prevailing libertarian and anti-communist tendencies of the wider transhumanist community.'),
        question('l1-2', 'What happens if high-tech breakthroughs are distributed through market competition, according to the lesson?', ['They become free for everyone', 'They disappear', 'They become luxury goods for the rich', 'They are banned'], 2, 'If high-tech breakthroughs are distributed through market competition, they become luxury goods for the rich.'),
        question('l1-3', 'What does Left Transhumanism demand for all transformative technology?', ['That it be democratized, open-source and guaranteed as shared human infrastructure', 'That it be patented', 'That it be kept secret', 'That it be sold at auction'], 0, 'Left Transhumanism demands that all transformative technology be democratized, open-source, and guaranteed as shared human infrastructure.'),
        question('l1-4', 'Which of these is one of Left Transhumanism’s objectives?', ['Abolish the internet', 'Win every election alone', 'End space exploration', 'Trace the left-wing roots of proto-transhumanist movements such as Russian Cosmism and Biocosmism'], 3, 'Its objectives are to trace those left-wing roots, turn left leaning people ‘Pro-Tech’, organize leftists in transhumanist spaces, and influence the transhumanist community leftward.'),
        question('l1-5', 'What does countering perceptions of elitism require, according to the lesson?', ['More venture capital', 'Active organizing, accessible education and popular movement-building', 'Silence', 'Leaving the transhumanist community'], 1, 'Countering perceptions of elitism requires active organizing, accessible education, and popular movement-building.'),
      ],
    ),
    lesson(
      'left-201',
      2,
      '201: Ideologies, movements and allies',
      'The left traditions within Left Transhumanism, taking it into broader movements, and its partnerships and allies.',
      8,
      [
        [
          'Ideologies',
          'The group encompasses a wide spectrum of left traditions, including Marxist-Leninists, Cosmists, Anarcho-Transhumanists, Market Socialists, Democratic Socialists, Maoists, and Cybernetic Socialists. Despite ideological differences, these currents are unified by a commitment to post-capitalist aims, scientific advancement, universal access to human enhancement, and active opposition to tech-right or libertarian trajectories.',
        ],
        [
          'Diffusion into Broader Movements',
          'A goal of Left Transhumanism is to influence left-leaning individuals in a ‘Pro-Tech’ direction if not outright Transhumanist. This requires taking a Transhumanistic perspective to other movements, groups, organizations, etc. and building within those movements. Most Transhumanists and Left Transhumanists engage in politics outside of the Transhumanist community in certain Socialist, Communist, Democratic Socialist, or otherwise left-leaning groups. Given the ideological diversity, this has already occurred naturally to an extent, but it remains a goal to be advanced.',
        ],
        [
          'Partnerships & Allies',
          'Given the ideological diversity within Left Transhumanism, partnerships and allies have naturally formed. From Facebook to Discord to Instagram and X (Twitter), various partnerships have been made; in that process, many allies have been gained, creating a type of ‘cross membership’ environment, or one where political sympathy goes both ways, in addition to coordinated support for left wing ideals, exchanging ideas on policy and political strategies, having unofficial meetings, etc.',
        ],
      ],
      [
        question('l2-1', 'Which of these traditions does the lesson list within Left Transhumanism?', ['Only Democratic Socialists', 'Libertarians and anarcho-capitalists', 'Marxist-Leninists, Cosmists, Anarcho-Transhumanists, Market Socialists, Democratic Socialists, Maoists and Cybernetic Socialists', 'Only Marxist-Leninists'], 2, 'The group encompasses a wide spectrum of left traditions, from Marxist-Leninists and Cosmists to Maoists and Cybernetic Socialists.'),
        question('l2-2', 'Despite their differences, what unifies these currents?', ['Post-capitalist aims, scientific advancement, universal access to human enhancement and opposition to tech-right or libertarian trajectories', 'A single leader', 'A shared religion', 'Support for enhancement sold on the market'], 0, 'These currents are unified by a commitment to post-capitalist aims, scientific advancement, universal access to human enhancement, and active opposition to tech-right or libertarian trajectories.'),
        question('l2-3', 'What does diffusion into broader movements require, according to the lesson?', ['Leaving every other movement', 'Advertising online only', 'Forming a new country', 'Taking a transhumanistic perspective to other movements and building within them'], 3, 'This requires taking a Transhumanistic perspective to other movements, groups and organizations and building within those movements.'),
        question('l2-4', 'Where does the lesson say partnerships have been made?', ['Only in person', 'Facebook, Discord, Instagram and X (Twitter)', 'Only by email', 'On television'], 1, 'From Facebook to Discord to Instagram and X (Twitter), various partnerships have been made.'),
        question('l2-5', 'What does the lesson mean by a ‘cross membership’ environment?', ['One where political sympathy goes both ways', 'One where members must leave other groups', 'One with paid membership', 'One closed to new members'], 0, 'Many allies have been gained, creating a ‘cross membership’ environment, or one where political sympathy goes both ways.'),
      ],
    ),
    lesson(
      'left-301',
      3,
      '301: Luddism, Solarpunk and Malthusianism',
      'Two views of the Luddites, Solarpunk, and why Left Transhumanism rejects Malthusianism.',
      8,
      [
        [
          'The ‘Luddism’ Question',
          'Within the Transhumanist community, the term “Luddite” is used to describe the “anti-technology” reaction of English textile workers in the 19th century. Despite this, there are two views. One is that the Luddites did not challenge technology itself; rather, they challenged the social relations that governed its use. In other words, the Luddites sought to challenge not what the technology does, but who it does it for and who it does it to. Two is that the Luddites are viewed as “the vanished status of the workman of the Middle Ages” trying to restore feudal relations, fighting to preserve a hierarchy that benefited them, a hierarchy built on seven year apprenticeships, guild monopolies, the exclusion of women, and the exclusion of the unskilled. There is no set opinion.',
        ],
        [
          'Solarpunk',
          'Solarpunk is a movement and ‘aesthetic’ typically seen as friendly to a light or subtle version of left wing transhumanism. At its core, it explicitly rejects the dystopian trajectories of ‘cyberpunk’ and techno-capitalism. It focuses on sustainability as well as a future powered by renewable energy, particularly solar power. It’s seen as a response to the negative consequences of industrialization and climate change, aiming to create a world that is environmentally friendly, socially just, and technologically advanced.',
        ],
        [
          'Against Malthusianism',
          'Be it left wing or right wing, Malthusianism is centered on the belief that unchecked population growth will rapidly outpace food production and resource availability, leading to various disasters. Most, if not all, in Left Transhumanism take this to be a capitalistic lie in that it causes people not to look at the global system of distribution and the possibilities through systemic change; rather, Malthusianism looks at the people and places the blame on humanity itself. This belief will not be accepted and will be pushed back when/where encountered.',
        ],
      ],
      [
        question('l3-1', 'Whose reaction does the term “Luddite” describe?', ['Soviet engineers', 'English textile workers in the 19th century', 'Medieval monks', 'American factory owners'], 1, 'The term “Luddite” is used to describe the “anti-technology” reaction of English textile workers in the 19th century.'),
        question('l3-2', 'What is Left Transhumanism’s position on the Luddism question?', ['That the Luddites were right to destroy all technology', 'That the Luddites were paid by factory owners', 'That the question never comes up', 'There is no set opinion: two views are held'], 3, 'There are two views, and there is no set opinion.'),
        question('l3-3', 'In the first view, what did the Luddites challenge?', ['The social relations that governed technology’s use: who it does it for and who it does it to', 'Technology itself', 'Their own guilds', 'Women working'], 0, 'In the first view, the Luddites challenged not what the technology does, but who it does it for and who it does it to.'),
        question('l3-4', 'What does Solarpunk explicitly reject?', ['Renewable energy', 'Social justice', 'The dystopian trajectories of ‘cyberpunk’ and techno-capitalism', 'Technology'], 2, 'At its core, Solarpunk explicitly rejects the dystopian trajectories of ‘cyberpunk’ and techno-capitalism.'),
        question('l3-5', 'How do most in Left Transhumanism view Malthusianism?', ['As a capitalistic lie that blames humanity instead of looking at the global system of distribution', 'As proven science', 'As a left wing idea they support', 'As irrelevant to politics'], 0, 'Most, if not all, take it to be a capitalistic lie that places the blame on humanity itself rather than on the global system of distribution.'),
      ],
    ),
    lesson(
      'left-401',
      4,
      '401: Abortion, artificial wombs and LGBTQIA+ rights',
      'Morphological freedom and abortion, state-sponsored artificial wombs, and self-determined identity.',
      8,
      [
        [
          'Reframing the Abortion Issue',
          'From a transhumanist perspective, morphological freedom is a civil right: the absolute authority to upgrade, modify/change, or ‘liberate’ your body using technology. Abortion is one of the battlegrounds for this principle. Ultimately, defending abortion access isn’t just about reproductive rights. It’s the fundamental line in the sand against bio-conservatism, showing that an individual’s conscious mind, not government authority, owns the physical machine it inhabits.',
        ],
        [
          'Artificial Wombs [Ectogenesis]',
          'Rather than treating artificial wombs, or ‘ectogenesis’, as an alternative to abortion or a high priced luxury item for private markets, state-sponsored artificial wombs need to be viewed as a part of universal healthcare designed to dismantle reproductive inequalities within the foundational biological division of reproductive labor. Decommodifying and nationalizing reproductive technology frees individuals from involuntary biological burdens, secures genuine bodily autonomy, and eliminates the risk of corporate monopolies controlling human reproduction.',
        ],
        [
          'LGBTQIA+ Rights',
          'Left transhumanism asserts that human identity is inherently self-determined rather than bound by biological determinism or reactionary concepts of “natural law.” It stands against systemic economic uncertainty, housing discrimination, targeted state violence, and thus induced psychological stress. Addressing these structural hallmarks requires moving beyond commodified healthcare to demand universal access to body modifying technologies as public goods, while simultaneously implementing broader socioeconomic reforms and anti-capitalist transformations that separate a person’s right to flourish from their class status or market value.',
        ],
      ],
      [
        question('l4-1', 'From a transhumanist perspective, what is morphological freedom?', ['A tax on body modification', 'A ban on medical technology', 'A fashion trend', 'A civil right: the authority to upgrade, modify or ‘liberate’ your body using technology'], 3, 'Morphological freedom is a civil right: the absolute authority to upgrade, modify/change, or ‘liberate’ your body using technology.'),
        question('l4-2', 'What does the lesson say defending abortion access shows?', ['That government should decide about bodies', 'That an individual’s conscious mind, not government authority, owns the physical machine it inhabits', 'That technology is unnatural', 'Nothing about bio-conservatism'], 1, 'Defending abortion access is the fundamental line in the sand against bio-conservatism, showing that an individual’s conscious mind, not government authority, owns the physical machine it inhabits.'),
        question('l4-3', 'How should state-sponsored artificial wombs be viewed, according to the lesson?', ['As part of universal healthcare, designed to dismantle reproductive inequalities', 'As an alternative to abortion', 'As a high priced luxury for private markets', 'As a corporate product'], 0, 'State-sponsored artificial wombs need to be viewed as a part of universal healthcare designed to dismantle reproductive inequalities.'),
        question('l4-4', 'Decommodifying and nationalizing reproductive technology eliminates the risk of what?', ['Public healthcare', 'Bodily autonomy', 'Corporate monopolies controlling human reproduction', 'Scientific research'], 2, 'It frees individuals from involuntary biological burdens, secures bodily autonomy, and eliminates the risk of corporate monopolies controlling human reproduction.'),
        question('l4-5', 'How does left transhumanism see human identity?', ['As inherently self-determined, not bound by biological determinism or “natural law”', 'As fixed at birth', 'As decided by the market', 'As decided by the state'], 0, 'Left transhumanism asserts that human identity is inherently self-determined rather than bound by biological determinism or reactionary concepts of “natural law.”'),
      ],
    ),
    lesson(
      'left-501',
      5,
      '501: Disability, aging and the longevity hype',
      'Disability rights and morphological freedom, the social hallmarks of aging, and the longevity hype.',
      10,
      [
        [
          'Disability Rights',
          'Left Transhumanists tend to bridge these spaces by advocating for morphological freedom within an anti-ableist framework. Technology should be available to adapt, enhance, or restore physical and neurological functions strictly on the individual’s own terms, free from normative market or social pressures. This is in addition to changing society to be more accessible [i.e. elevators, wheelchair ramps, tactile paving, curb cuts, etc.].',
        ],
        [
          'Social vs Biological Approach to Aging',
          'Transhumanists are the few advocates who approach aging as something to be changed. A continuation of the influence of Russian Cosmism, an ideology that has influentially jumped from the USSR to China, Cuba, and the USA. Nevertheless the way most Transhumanists take up the issue of aging is mostly through a biological lens that is curable in the labs and clinics rather than a combined approach that addresses both the biological and the ‘social hallmarks’ of aging such as being of low socioeconomic status, having adversity in childhood/adulthood, being a member of a minority group, adverse health behaviors, and adverse psychological states. Addressing the social hallmarks of aging would require more socioeconomic reforms/changes, some ranging outside of what is seen as ‘capitalism’.',
        ],
        [
          'The Longevity-Hype',
          'Every day, 100,000 people die from aging, making it 36.5 million people by the end of a year. A maintained outcome that has existed for decades and one that carries over to other industries such as Cryonics. For example, FM-2030’s impending 2030 revival date may be missed due to faulty expectations of private capital to adequately fund science and technology over chasing rapid short-term profit returns. These same market forces guarantee a dystopian biological ‘caste system’ with life extension and longevity treatments being a high luxury commodity reserved first for the wealthy, while the rest are left to deteriorate by traditional biological lifespans. Not so shockingly, this is occurring in its infancy with figures such as Bryan Johnson, Elon Musk, Jeff Bezos, etc.',
        ],
      ],
      [
        question('l5-1', 'On whose terms should technology to adapt, enhance or restore functions be available, according to the lesson?', ['An employer’s', 'An insurer’s', 'Strictly the individual’s own, free from normative market or social pressures', 'The state’s alone'], 2, 'Technology should be available strictly on the individual’s own terms, free from normative market or social pressures.'),
        question('l5-2', 'Besides technology, what else does the lesson call for in disability rights?', ['Nothing else', 'Changing society to be more accessible, with elevators, wheelchair ramps, tactile paving and curb cuts', 'Separate schools', 'Fewer public buildings'], 1, 'This is in addition to changing society to be more accessible, such as elevators, wheelchair ramps, tactile paving and curb cuts.'),
        question('l5-3', 'Which of these does the lesson list as a ‘social hallmark’ of aging?', ['Being of low socioeconomic status', 'Eating vegetables', 'Living near a park', 'Reading books'], 0, 'The social hallmarks of aging include low socioeconomic status, adversity in childhood or adulthood, being a member of a minority group, adverse health behaviors and adverse psychological states.'),
        question('l5-4', 'About how many people die from aging every day, according to the lesson?', ['1,000', '10,000', '1 million', '100,000'], 3, 'Every day, 100,000 people die from aging, making it 36.5 million people by the end of a year.'),
        question('l5-5', 'What does the lesson warn market forces guarantee with life extension and longevity treatments?', ['A dystopian biological ‘caste system’, with treatments reserved first for the wealthy', 'Free treatments for everyone', 'No change at all', 'A ban on longevity research'], 0, 'These market forces guarantee a dystopian biological ‘caste system’, with longevity treatments a high luxury commodity reserved first for the wealthy.'),
      ],
    ),
    lesson(
      'ustp-left',
      6,
      'The USTP-Left',
      'The USTP-Left: a faction of left wing members within the Transhumanist Party, and its goals.',
      5,
      [
        [
          'USTP-Left',
          'The ‘USTP-Left’ is an effort within the broader aim of organizing leftists within pro-technological/transhumanist spaces as well as influencing the Transhumanist community at-large. The function of the USTP-Left is to act as a unified ‘faction’ of left wing members within the Libertarian politics of the Transhumanist Party. This means pushing and backing left wing ideas generally, retracing socialist/progressive history as proto-transhumanist, taking up issues with certain right wing Libertarian informed positions within the party, acting as a type of ‘voting bloc’ within the party, and promoting/fostering a general notion of left wing unity between the communists, techno-progressives, anarchists, left wing technocrats, socialists, etc.',
        ],
        [
          'USTP-Left’s Goals',
          'Its established aim is organizing leftists within pro-technological/transhumanist spaces as well as influencing the Transhumanist community at-large.',
        ],
      ],
      [
        question('u-1', 'What is the function of the USTP-Left?', ['To replace the Transhumanist Party', 'To act as a unified ‘faction’ of left wing members within the Transhumanist Party', 'To run the party’s elections', 'To leave the party'], 1, 'The function of the USTP-Left is to act as a unified ‘faction’ of left wing members within the Libertarian politics of the Transhumanist Party.'),
        question('u-2', 'What kind of bloc does the USTP-Left act as within the party?', ['A type of ‘voting bloc’', 'A trade bloc', 'A security team', 'A fundraising committee'], 0, 'One of its functions is acting as a type of ‘voting bloc’ within the party.'),
        question('u-3', 'How does the USTP-Left treat socialist and progressive history?', ['It ignores it', 'It rejects it', 'It treats it as unrelated to technology', 'It retraces it as proto-transhumanist'], 3, 'It retraces socialist/progressive history as proto-transhumanist.'),
        question('u-4', 'Between whom does the USTP-Left foster left wing unity?', ['Only libertarians', 'Only party officers', 'Communists, techno-progressives, anarchists, left wing technocrats, socialists and others', 'Only members in one state'], 2, 'It promotes a general notion of left wing unity between the communists, techno-progressives, anarchists, left wing technocrats, socialists, etc.'),
        question('u-5', 'What is the USTP-Left’s established aim?', ['Organizing leftists within pro-technological and transhumanist spaces, and influencing the transhumanist community at large', 'Ending the Transhumanist Party', 'Banning technology', 'Winning a presidential election alone'], 0, 'Its established aim is organizing leftists within pro-technological/transhumanist spaces as well as influencing the Transhumanist community at-large.'),
      ],
    ),
  ],
};
