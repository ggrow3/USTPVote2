import { lessonsOf, question, type SeededCourse } from './lessons.js';

const COURSE_ID = 'figures-of-transhumanism';
const lesson = lessonsOf(COURSE_ID);

/**
 * Historical Figures 101 to 501, from the party's curriculum. They are lessons rather than futurist profiles: a
 * published profile needs a sourced quote and an open-licence portrait, which a Course Administrator can add later.
 */
export const figuresOfTranshumanism: SeededCourse = {
  courseId: COURSE_ID,
  title: 'The Figures of Transhumanism',
  summary:
    'Historical Figures 101 to 501: fifteen thinkers, scientists and revolutionaries, from Karl Marx and Nikolai Fedorov to FM-2030, and the ideas that tie them to transhumanism.',
  placement: null,
  lessons: [
    lesson(
      'figures-101',
      1,
      '101: Marx, Fedorov and Tsiolkovsky',
      'Marx’s ‘proto-transhumanism’, Fedorov’s Common Task, and Tsiolkovsky’s rocketry.',
      10,
      [
        [
          'Karl Marx',
          'Marx is well known enough to skip an introduction; however, his ‘proto-transhumanist’ views are less focused on. His ‘proto-transhumanism’ can be seen in “Grundrisse”, where Marx argued that science increasingly becomes the main productive force, reducing human labor to a minor role, setting the stage for the later Cosmist beliefs in humanity’s conscious control over nature [1]. That very idea of having conscious control over nature shows up in the beliefs of different communists, socialists, anarchists, etc., throughout history from Tsiolkovsky to Svyatogor to Haldane, Stalin, and Mao.',
          '[1] https://ojs.library.ubc.ca/index.php/newproposals/article/view/196704',
        ],
        [
          'Nikolai Fedorov',
          'Fedorov, the ‘Socrates of Moscow’ and the founder of Russian Cosmism, was a philosopher who proposed the idea of the “Common Task”: a collective effort on the part of humanity ‘to regulate the forces of nature, to defeat death and bring ancestors back to life.’ These ideas led to the development of later secularized versions of Fedorov’s ‘antideath’ vision, such as space exploration, rejuvenation attempts, planetary engineering, and preservation attempts after death. Cosmism would go on to continue after Fedorov with ideological offshoots like Biocosmism or its influence on modern-day Transhumanism.',
        ],
        [
          'Konstantin Tsiolkovsky',
          'Tsiolkovsky, the ‘grandfather of Soviet rocket science,’ was a scientist, author, visionary, and socialist/cosmist who, in addition to laying the scientific groundwork for Soviet space exploration with contributions such as the ‘Tsiolkovsky rocket equation,’ transformed the Cosmist aspiration of space exploration into a practical program of rocketry. Part of his approach was successfully mixing practical and cultural efforts or narratives to influence the next generation that went on to build Sputnik. That influence on space exploration is still felt to this day.',
        ],
      ],
      [
        question('h1-1', 'In which work does the lesson find Marx’s ‘proto-transhumanism’?', ['The Communist Manifesto', 'Red Star', 'Grundrisse', 'Literature and Revolution'], 2, 'His proto-transhumanism can be seen in “Grundrisse”.'),
        question('h1-2', 'What did Marx argue there, according to the lesson?', ['That science increasingly becomes the main productive force, reducing human labor to a minor role', 'That technology should be abolished', 'That human labor will always grow', 'That nature cannot be understood'], 0, 'Marx argued that science increasingly becomes the main productive force, reducing human labor to a minor role, setting the stage for the Cosmist belief in humanity’s conscious control over nature.'),
        question('h1-3', 'Who was the ‘Socrates of Moscow’ and the founder of Russian Cosmism?', ['Konstantin Tsiolkovsky', 'Nikolai Fedorov', 'Alexander Bogdanov', 'Karl Marx'], 1, 'Fedorov, the ‘Socrates of Moscow’, was the founder of Russian Cosmism.'),
        question('h1-4', 'What was Fedorov’s “Common Task”?', ['A five-year plan for industry', 'A plan for the first computer network', 'A rule for party meetings', 'A collective effort of humanity to regulate the forces of nature, defeat death and bring ancestors back to life'], 3, 'The Common Task was a collective effort on the part of humanity ‘to regulate the forces of nature, to defeat death and bring ancestors back to life.’'),
        question('h1-5', 'What did Tsiolkovsky turn the Cosmist aspiration of space exploration into?', ['A practical program of rocketry, influencing the generation that built Sputnik', 'A religion', 'A novel and nothing more', 'A law against space travel'], 0, 'Tsiolkovsky transformed the Cosmist aspiration of space exploration into a practical program of rocketry and influenced the next generation that went on to build Sputnik.'),
      ],
    ),
    lesson(
      'figures-201',
      2,
      '201: Bogdanov, Svyatogor and Haldane',
      'Bogdanov’s blood transfusions and Red Star, Svyatogor’s atheist Biocosmism, and Haldane’s science.',
      10,
      [
        [
          'Alexander Bogdanov',
          'Bogdanov was a physician, philosopher, and cosmist who, from opening the world’s first institution devoted to blood transfusion for longevity purposes, to authoring books such as Red Star which explored ideas like immortality, space travel, and automation, to co-founding the Bolsheviks (who went on to put forth a type of ‘utopianism’ from the top down, in large part due to the influence of cosmism), pushed various cosmist ideals onto the stage of state directive and worked to turn those ideals into practical approaches.',
        ],
        [
          'Alexander Agienko (Svyatogor)',
          'Agienko, or ‘Svyatogor,’ was an anarchist, futurist, commander of the ‘Black Guards,’ and founder of the Biocosmist movement, a later movement influenced by cosmism and Fedorov. Its advocates flatly condemned any ‘religious or mystical tendencies’ that lingered in Fedorov’s philosophy. Svyatogor’s writings sought to distance Biocosmism from anything that could not be classified as a hard science. For example, in “Our Affirmations”, Svyatogor explained how the quest for immortality was distinctly practical and atheist, a belief that would define the Biocosmist movement.',
        ],
        [
          'J.B.S. Haldane',
          'J. B. S. Haldane was a scientist, Marxist, and author, contributing to many fields like genetics and evolutionary biology, as well as coining terms such as ‘clone’ and ‘ectogenesis’ [artificial wombs]. He was a member of the International Brigades during the Spanish Civil War as well as a member of the Communist Party of Great Britain. A very influential figure, he went on to influence the likes of Aldous Huxley, serving as the basis for the biologist named Shearwater in Huxley’s novel Antic Hay, in addition to influencing Huxley’s “Brave New World”.',
        ],
      ],
      [
        question('h2-1', 'Which of Bogdanov’s books explored immortality, space travel and automation?', ['Antic Hay', 'Red Star', 'The Argonauts of the Universe', 'Our Affirmations'], 1, 'Bogdanov authored books such as Red Star, which explored ideas like immortality, space travel, and automation.'),
        question('h2-2', 'What kind of institution did Bogdanov open, according to the lesson?', ['The first rocket factory', 'The first school for deaf students', 'The world’s first institution devoted to blood transfusion for longevity purposes', 'The first cryonics laboratory'], 2, 'He opened the world’s first institution devoted to blood transfusion for longevity purposes.'),
        question('h2-3', 'What did Svyatogor’s Biocosmists condemn in Fedorov’s philosophy?', ['Any ‘religious or mystical tendencies’ that lingered in it', 'Its interest in space', 'Its aim to defeat death', 'Its focus on science'], 0, 'Its advocates flatly condemned any ‘religious or mystical tendencies’ that lingered in Fedorov’s philosophy; in “Our Affirmations” the quest for immortality was practical and atheist.'),
        question('h2-4', 'Which two terms does the lesson say J.B.S. Haldane coined?', ['‘Robot’ and ‘cyborg’', '‘Gene’ and ‘genome’', '‘Transhumanism’ and ‘cosmism’', '‘Clone’ and ‘ectogenesis’'], 3, 'Haldane coined terms such as ‘clone’ and ‘ectogenesis’ (artificial wombs).'),
        question('h2-5', 'Which character in Aldous Huxley’s novel Antic Hay was based on Haldane?', ['The biologist named Shearwater', 'The World Controller', 'John the Savage', 'A Soviet commissar'], 0, 'Haldane served as the basis for the biologist named Shearwater in Antic Hay, and also influenced “Brave New World”.'),
      ],
    ),
    lesson(
      'figures-301',
      3,
      '301: Glushkov, Kuprevich and Kollontai',
      'Glushkov’s OGAS network, Kuprevich’s gerontology, and Kollontai’s laws.',
      10,
      [
        [
          'Victor Glushkov',
          'Victor Glushkov was a mathematician known for his proposal ‘OGAS’, a computer network that would manage the distribution of resources/information within the Soviet economy, achieving a ‘higher form’ of socialist planning. Although never coming to fruition due to entrenched party interests, it did inspire ‘Project Cybersyn’ used in Chile under Salvador Allende. If implemented, Glushkov envisioned equipping the system with a rudimentary form of AI based on neural networks, imagining people being able to upload their minds to the network for a kind of ‘immortality’.',
        ],
        [
          'Vasily Kuprevich',
          'Vasily Kuprevich was a cosmist, botanist, and proponent of unlimited longevity from his early days storming the Winter Palace to his later participation in WWII. Later, he turned to more controversial work involving the aging of plants, animals, and humans, essentially introducing the science of gerontology to the USSR. As a Cosmist thinker, he became best known for his Fedorovian contention that death is not necessary, and that someday relatively soon, perhaps within the twenty-first century, science would discover the means to prolong life indefinitely.',
        ],
        [
          'Alexandra Kollontai',
          'Kollontai was a revolutionary, feminist, and the first female cabinet minister in modern history (USSR). She helped write many of the laws that legalized abortion, divorce, birth control, decriminalized homosexuality and prostitution, and promoted women’s voting rights through her work in ‘Zhenotdel’ (the Women’s department of the Bolsheviks). Kollontai held that the ‘new Soviet man/woman’ would transcend rigid patriarchal forms, theorizing that free love and full emancipation were the appropriate relationships for a post-capitalist society.',
        ],
      ],
      [
        question('h3-1', 'What was Victor Glushkov’s proposed ‘OGAS’?', ['A rocket engine', 'A computer network to manage the distribution of resources and information within the Soviet economy', 'A method of blood transfusion', 'A plan for shelterbelts of trees'], 1, 'OGAS was a computer network that would manage the distribution of resources and information within the Soviet economy, achieving a ‘higher form’ of socialist planning.'),
        question('h3-2', 'Why, according to the lesson, did OGAS never come to fruition?', ['Entrenched party interests', 'There were no computers', 'A war', 'Glushkov abandoned it'], 0, 'OGAS never came to fruition due to entrenched party interests.'),
        question('h3-3', 'Which science does the lesson say Vasily Kuprevich essentially introduced to the USSR?', ['Rocketry', 'Genetics', 'Cybernetics', 'Gerontology, the science of aging'], 3, 'His work on the aging of plants, animals, and humans essentially introduced the science of gerontology to the USSR.'),
        question('h3-4', 'What Fedorovian contention was Kuprevich best known for?', ['That death is natural and good', 'That space travel is impossible', 'That death is not necessary, and science would someday discover the means to prolong life indefinitely', 'That plants do not age'], 2, 'He became best known for his Fedorovian contention that death is not necessary, and that perhaps within the twenty-first century science would discover the means to prolong life indefinitely.'),
        question('h3-5', 'What does the lesson say Alexandra Kollontai was the first woman to be?', ['A cabinet minister in modern history', 'In space', 'A rocket scientist', 'A Red Army commander'], 0, 'Kollontai was the first female cabinet minister in modern history (USSR).'),
      ],
    ),
    lesson(
      'figures-401',
      4,
      '401: Che Guevara, Mao Zedong and FM-2030',
      'Che Guevara’s new human, Mao’s proto-transhumanism, and FM-2030’s post-scarcity future.',
      10,
      [
        [
          'Ernesto “Che” Guevara',
          'Che Guevara was a revolutionary, politician, and theorist who is known for aiding liberation movements. He argued for using automated systems and mathematics to coordinate the economy, replacing capitalist market mechanisms with centralized scientific management. In addition, he theorized that a radical and egalitarian system would transform humanity and create a ‘new human.’ In his work “Man and Socialism in Cuba”, he stated that to build communism, it is necessary to build the new man and woman alongside the new material foundations.',
        ],
        [
          'Mao Zedong',
          'Mao was a revolutionary, political theorist, proto-transhumanist, and the founder of the People’s Republic of China. He inspired new medical approaches to help people with physical impairments, such as acupuncture and work by PLA medical orderlies treating those who could neither hear nor speak. He also held Proto-Transhumanist or Biocosmist perspectives, viewing theological talk of ‘doomsday’ as terrifying and limited. He stated that the end of humanity as currently known would produce ‘something more advanced than mankind,’ observing that ‘Mankind is still in its infancy.’',
        ],
        [
          'FM-2030',
          'FM-2030 was a transhumanist who dismissed the political left and right of his era as ‘bioconservative’ for ignoring human limitations like death. However, his ideals closely mirrored classical communism. Reacting against the neo-Luddite left of his time, he argued capitalism and state socialism were trapped by scarcity and a puritan work ethic. Instead, he envisioned a post-scarcity world of mass automation, radical abundance from space mining, and borderless universal citizenship. Though FM-2030 claimed his evolutionary optimism surpassed Marx, this misread Marx’s own visions of overcoming scarcity and drudgery. Despite distancing himself from traditional leftism, FM-2030’s core philosophies, including his anti-religious stance and radically progressive view that living as one gender is boring, aligned neatly with classical communist internationalism.',
        ],
      ],
      [
        question('h4-1', 'In “Man and Socialism in Cuba”, what did Che Guevara say is necessary to build communism?', ['To return to markets', 'To build the new man and woman alongside the new material foundations', 'To give up technology', 'To end schooling'], 1, 'He stated that to build communism, it is necessary to build the new man and woman alongside the new material foundations.'),
        question('h4-2', 'What did Guevara argue should coordinate the economy in place of capitalist market mechanisms?', ['Chance', 'Private monopolies', 'Barter', 'Automated systems and mathematics, as centralized scientific management'], 3, 'He argued for using automated systems and mathematics to coordinate the economy, replacing capitalist market mechanisms with centralized scientific management.'),
        question('h4-3', 'Which medical approaches does the lesson say Mao inspired for people with physical impairments?', ['Acupuncture, and work by PLA medical orderlies treating those who could neither hear nor speak', 'Cryonics', 'Blood transfusions between young and old', 'Artificial wombs'], 0, 'He inspired new medical approaches such as acupuncture and work by PLA medical orderlies treating those who could neither hear nor speak.'),
        question('h4-4', 'What did Mao observe about mankind, according to the lesson?', ['‘Mankind has reached its end’', '‘Mankind cannot change’', '‘Mankind is still in its infancy’', '‘Mankind should fear the future’'], 2, 'He stated that the end of humanity as currently known would produce ‘something more advanced than mankind,’ observing that ‘Mankind is still in its infancy.’'),
        question('h4-5', 'Why did FM-2030 call the political left and right of his era ‘bioconservative’?', ['For ignoring human limitations like death', 'For supporting space mining', 'For favoring automation', 'For opposing borders'], 0, 'FM-2030 dismissed the political left and right of his era as ‘bioconservative’ for ignoring human limitations like death.'),
      ],
    ),
    lesson(
      'figures-501',
      5,
      '501: Trotsky, Yaroslavsky and Krasin',
      'Trotsky’s Literature and Revolution, Yaroslavsky’s Northern Biocosmists, and Krasin’s plan for Lenin.',
      10,
      [
        [
          'Leon Trotsky',
          'Trotsky was a Marxist revolutionary, Red Army commander, and theorist, contributing to political philosophy and literary criticism while envisioning concepts akin to “morphic freedom”. He led the Petrograd Soviet during the 1917 October Revolution and served as the People’s Commissar for Military and Naval Affairs. A deeply radical thinker, his writings, “Literature and Revolution”, went on to echo the terraforming ambitions of Russian Cosmists and prefigure modern Transhumanism, famously predicting a socialist future where science elevates the average human baseline to the intellectual and aesthetic heights of an Aristotle, Goethe, or Marx.',
        ],
        [
          'Alexander Yaroslavsky',
          'Yaroslavsky was a poet, science fiction author, and leader of a Biocosmist group called the ‘Northern Biocosmist’ in Petrograd, an avant-garde Russian Cosmist movement focused on radical human transformation. As founder of the Biocosmists and editor of their journal Immortality, Yaroslavsky championed physical immortality, the scientific resurrection of the dead, and limitless cosmic space travel to liberate humanity from biological constraints. His 1926 science fiction novel, The Argonauts of the Universe, stands as a primary literary manifestation of these ideas before the movement was suppressed and Yaroslavsky was executed under Soviet rule in 1930.',
        ],
        [
          'Leonid Krasin',
          'Krasin was a Bolshevik revolutionary and Soviet diplomat who served as the first People’s Commissar for Foreign Trade and ambassador to Great Britain and France. Heavily influenced by Russian Cosmism and Alexander Bogdanov’s ideas on biological immortality, he believed that future scientific advancements would allow humanity to physically resurrect historical figures. This conviction led him to head the commission tasked with preserving Vladimir Lenin’s body after his death in 1924, where Krasin initially advocated for deep freezing, a type of early cryonics, of the corpse in hopes of future technological resurrection before the regime ultimately settled on permanent embalming.',
        ],
      ],
      [
        question('h5-1', 'In which writings did Trotsky predict a socialist future where science raises the average human to the heights of an Aristotle, Goethe or Marx?', ['Red Star', 'Grundrisse', 'Literature and Revolution', 'Immortality'], 2, 'His writings, “Literature and Revolution”, echoed the terraforming ambitions of the Russian Cosmists and prefigured modern transhumanism.'),
        question('h5-2', 'Which council did Trotsky lead during the 1917 October Revolution?', ['The Petrograd Soviet', 'The Moscow Duma', 'The Zhenotdel', 'The Commission for Foreign Trade'], 0, 'He led the Petrograd Soviet during the 1917 October Revolution.'),
        question('h5-3', 'Which journal did Alexander Yaroslavsky edit?', ['Red Star', 'Pravda', 'Message in a Bottle', 'Immortality'], 3, 'Yaroslavsky was the editor of the Biocosmists’ journal Immortality.'),
        question('h5-4', 'What was Yaroslavsky’s 1926 science fiction novel?', ['Red Star', 'The Argonauts of the Universe', 'Antic Hay', 'Brave New World'], 1, 'His 1926 science fiction novel, The Argonauts of the Universe, stands as a primary literary manifestation of these ideas.'),
        question('h5-5', 'What did Leonid Krasin first advocate for Lenin’s body after his death in 1924?', ['Deep freezing, a type of early cryonics, in hopes of future resurrection', 'Cremation', 'Burial without preservation', 'Permanent embalming from the start'], 0, 'Krasin initially advocated for deep freezing, a type of early cryonics, before the regime ultimately settled on permanent embalming.'),
      ],
    ),
  ],
};
