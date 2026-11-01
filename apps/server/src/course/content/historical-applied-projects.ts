import { lessonsOf, question, type SeededCourse } from './lessons.js';

const COURSE_ID = 'historical-applied-projects';
const lesson = lessonsOf(COURSE_ID);

/** Historical Applied Projects 101 to 501, from the party's curriculum: a new course after The Figures of Transhumanism. */
export const historicalAppliedProjects: SeededCourse = {
  courseId: COURSE_ID,
  title: 'Historical Applied Projects',
  summary:
    'Historical Applied Projects 101 to 501: fifteen projects that put these ideas into practice, from Soviet rocketry and Cuban medical internationalism to Burkina Faso’s vaccination campaign and Chile’s Project Cybersyn.',
  placement: { prerequisites: ['figures-of-transhumanism'], position: { row: 3, column: 1 } },
  lessons: [
    lesson(
      'projects-101',
      1,
      '101: Rockets, rejuvenation and remaking nature',
      'Soviet rocketry, Bogdanov’s blood transfusions, and the Great Plan for the Transformation of Nature.',
      8,
      [
        [
          'Rocketry & Human Expansion (USSR)',
          'Konstantin Tsiolkovsky saw rocketry as the key tool for human expansion into the cosmos. He believed humanity could not stay on Earth forever and must colonize space to survive and grow. His mathematical formulas and designs laid the theoretical groundwork for making that expansion possible. His work and legacy inspired those who would go on to contribute to Sputnik. People like Tikhonravov, Korolev, and Glushko would go on to send the first satellite into space in 1957.',
        ],
        [
          'Rejuvenation / Blood Transfusions (USSR)',
          'Alexander Bogdanov founded the world’s first institute for blood transfusion in Moscow in 1926. He believed that exchanging blood between older and younger people could reverse aging and restore youth.',
        ],
        [
          'Great Plan for the Transformation of Nature (USSR)',
          'Launched by decree in October 1948, Stalin’s ‘Great Plan for the Transformation of Nature’ was a massive state effort to consciously engineer the Soviet climate and biosphere. Relying on state-directed science, massive afforestation shelterbelts, canal networks, and geoengineering, it sought to alter microclimates, prevent drought, and change nature to serve societal needs.',
        ],
      ],
      [
        question('p1-1', 'Why did Tsiolkovsky believe humanity must colonize space?', ['To find gold', 'Humanity could not stay on Earth forever, and must colonize space to survive and grow', 'To escape the government', 'For sport'], 1, 'He believed humanity could not stay on Earth forever and must colonize space to survive and grow.'),
        question('p1-2', 'In what year did Tikhonravov, Korolev and Glushko send the first satellite into space?', ['1926', '1948', '1969', '1957'], 3, 'People like Tikhonravov, Korolev, and Glushko would go on to send the first satellite into space in 1957.'),
        question('p1-3', 'Where and when did Bogdanov found the world’s first institute for blood transfusion?', ['Moscow, in 1926', 'Petrograd, in 1917', 'Kyiv, in 1948', 'Moscow, in 1957'], 0, 'Alexander Bogdanov founded the world’s first institute for blood transfusion in Moscow in 1926.'),
        question('p1-4', 'What did Bogdanov believe exchanging blood between older and younger people could do?', ['Cure deafness', 'Prevent drought', 'Reverse aging and restore youth', 'Make space travel possible'], 2, 'He believed that exchanging blood between older and younger people could reverse aging and restore youth.'),
        question('p1-5', 'What did the Great Plan for the Transformation of Nature, launched in October 1948, seek to do?', ['Alter microclimates, prevent drought and change nature to serve societal needs', 'Send people to the Moon', 'Build a computer network', 'Vaccinate children'], 0, 'Relying on state-directed science, shelterbelts, canals and geoengineering, it sought to alter microclimates, prevent drought, and change nature to serve societal needs.'),
      ],
    ),
    lesson(
      'projects-201',
      2,
      '201: Digital immortality, sight and hearing',
      'Glushkov’s information systems, Operation Miracle, and hearing loss and acupuncture in China.',
      8,
      [
        [
          'Information Systems & Digital Immortality (USSR)',
          'Viktor Glushkov worked to reform and optimize the socialist planned economy using advanced computer networks. He envisioned ‘OGAS’ not just as a Soviet internet or cybercommunist network, but he wanted to equip it with a rudimentary form of AI based on neural networks, picturing people would be able to upload their minds to the network for a kind of immortality.',
        ],
        [
          'Operation Miracle (Cuba & Venezuela)',
          'Launched in July 2004 by Fidel Castro and Hugo Chavez, Operation Miracle was a joint Cuban/Venezuelan humanitarian initiative that provides free medical and surgical eye treatments to low income people suffering from preventable blindness and visual impairments.',
        ],
        [
          'Hearing Loss & Acupuncture (China)',
          'During the Chinese Great Proletarian Cultural Revolution, there were schools for deaf students in Peking and similar schools in every other province. A soldier named Chao Pu Yu and his medical team of the Chinese P.L.A. Unit 3125 treated 105 students of the Fuhsien School for Deaf students in Liaoning Province, enabling all of them to recover their hearing and speaking faculties.',
        ],
      ],
      [
        question('p2-1', 'Besides planning the economy, what did Glushkov picture people being able to do with OGAS?', ['Vote in elections', 'Order goods from abroad', 'Upload their minds to the network for a kind of immortality', 'Launch satellites'], 2, 'He wanted to equip OGAS with a rudimentary form of AI based on neural networks, picturing people uploading their minds to the network for a kind of immortality.'),
        question('p2-2', 'Who launched Operation Miracle in July 2004?', ['Fidel Castro and Hugo Chavez', 'Thomas Sankara and Fidel Castro', 'Claudia Sheinbaum', 'Salvador Allende'], 0, 'Operation Miracle was launched in July 2004 by Fidel Castro and Hugo Chavez as a joint Cuban/Venezuelan initiative.'),
        question('p2-3', 'What does Operation Miracle provide?', ['Vaccines against measles', 'Places at medical school', 'Free cataract surgeries in Mexico only', 'Free medical and surgical eye treatments for low income people with preventable blindness and visual impairments'], 3, 'It provides free medical and surgical eye treatments to low income people suffering from preventable blindness and visual impairments.'),
        question('p2-4', 'Who treated the 105 students of the Fuhsien School for Deaf students?', ['Doctors from Cuba', 'A soldier named Chao Pu Yu and his medical team of P.L.A. Unit 3125', 'Alexander Bogdanov', 'A team from abroad'], 1, 'A soldier named Chao Pu Yu and his medical team of the Chinese P.L.A. Unit 3125 treated the 105 students.'),
        question('p2-5', 'In which province was the Fuhsien School for Deaf students?', ['Liaoning', 'Guangdong', 'Sichuan', 'Yunnan'], 0, 'The Fuhsien School for Deaf students was in Liaoning Province.'),
      ],
    ),
    lesson(
      'projects-301',
      3,
      '301: Vaccines, doctors and care at home',
      'Burkina Faso’s Vaccination Commando, Cuba’s Latin American School of Medicine, and Mexico’s door-to-door healthcare.',
      8,
      [
        [
          'Vaccination Commando (Burkina Faso)',
          'Under Thomas Sankara’s leadership Burkina Faso vaccinated over 1 million children against measles, yellow fever, and meningitis during a 3-week nationwide campaign. The success of this campaign is attributed to 2 factors: 1) mobilization of medical personnel and the population, and 2) mass communication and intensive education.',
        ],
        [
          'Latin American School of Medicine (Cuba)',
          'The Latin American School of Medicine or ‘ELAM’ has been described as possibly being the largest medical school in the world by enrollment, per a 2012 report. International students are accepted and offered paid tuition, room and board, and a small stipend. The aim is to make competent and cooperative doctors with the degree of Doctor of Medicine (M.D.), the degree required to practice as a physician across the Americas.',
        ],
        [
          'Healthcare Door-to-Door (Mexico)',
          'President of Mexico, Claudia Sheinbaum, announced Mexico’s “Salud Casa por Casa” program, beginning in 2026, created to provide free cataract surgeries for seniors as part of the government’s commitment to improve well-being and deliver health services to those most in need.',
        ],
      ],
      [
        question('p3-1', 'How many children did Burkina Faso vaccinate in its 3-week campaign under Thomas Sankara?', ['About 10,000', 'About 100,000', 'Over 1 million', 'Over 10 million'], 2, 'Under Thomas Sankara’s leadership Burkina Faso vaccinated over 1 million children during a 3-week nationwide campaign.'),
        question('p3-2', 'Against which diseases were they vaccinated?', ['Polio, smallpox and tuberculosis', 'Measles, yellow fever and meningitis', 'Malaria and cholera', 'Influenza only'], 1, 'The children were vaccinated against measles, yellow fever, and meningitis.'),
        question('p3-3', 'To which two factors is the campaign’s success attributed?', ['Mobilizing medical personnel and the population, and mass communication with intensive education', 'Foreign money and private clinics', 'Fines and police', 'New vaccines and luck'], 0, 'Its success is attributed to the mobilization of medical personnel and the population, and to mass communication and intensive education.'),
        question('p3-4', 'What did a 2012 report describe the Latin American School of Medicine (ELAM) as possibly being?', ['The oldest medical school in the Americas', 'The most expensive medical school', 'A school for nurses only', 'The largest medical school in the world by enrollment'], 3, 'ELAM has been described as possibly being the largest medical school in the world by enrollment, per a 2012 report.'),
        question('p3-5', 'What is Mexico’s “Salud Casa por Casa” program created to provide, according to the lesson?', ['Free cataract surgeries for seniors', 'Free vaccines for children', 'Free medical degrees', 'Free eye treatment in Venezuela'], 0, 'The program was created to provide free cataract surgeries for seniors.'),
      ],
    ),
    lesson(
      'projects-401',
      4,
      '401: Doctors abroad, industry and trees',
      'Cuba’s White Coat Army, Soviet industrialization and collectivization, and One Village, One Grove.',
      8,
      [
        [
          'White Coat Army (Cuba)',
          'After the 1959 Cuban Revolution, Cuba established a program of medical internationalism: to send its medical personnel overseas. Since 1963, Cuban health workers have provided medical services in more than 160 countries, and in 2020, Cuban doctors were active in over 60 nations.',
        ],
        [
          'Mass Industrialization & Collectivization (USSR)',
          'Stalin’s collectivization and industrialization can be reinterpreted as primitive and productive steps in the direction of Fedorov’s and Tsiolkovsky’s vision. The first five-year plan reframed rapid industrialization as a necessary, transformative step towards human cosmic evolution and the mastery of nature.',
        ],
        [
          'One Village, One Grove (Burkina Faso)',
          'The One Village, One Grove program planted several million trees in Africa’s first campaign against desertification, much like the Great Green Wall initiative. Feudal landlords were stripped of their rights to tribute payments and forced labour, and land was distributed amongst the peasantry, which led to the doubling of the average yield of 1,700kg of wheat per hectare in 1982 to 3,800kg by 1986. As a result, in just four years, hunger was banished and Burkina Faso became completely self-sufficient.',
        ],
      ],
      [
        question('p4-1', 'Since 1963, in how many countries have Cuban health workers provided medical services?', ['About 20', 'More than 160', 'Only in Latin America', 'Fewer than 10'], 1, 'Since 1963, Cuban health workers have provided medical services in more than 160 countries; in 2020, Cuban doctors were active in over 60 nations.'),
        question('p4-2', 'How does the lesson reinterpret Stalin’s collectivization and industrialization?', ['As a rejection of Cosmism', 'As a plan for space mining', 'As a medical program', 'As primitive and productive steps in the direction of Fedorov’s and Tsiolkovsky’s vision'], 3, 'They can be reinterpreted as primitive and productive steps in the direction of Fedorov’s and Tsiolkovsky’s vision.'),
        question('p4-3', 'What did the first five-year plan reframe rapid industrialization as?', ['A necessary, transformative step towards human cosmic evolution and the mastery of nature', 'A temporary emergency', 'A way to end science', 'A plan to reduce the population'], 0, 'The first five-year plan reframed rapid industrialization as a necessary, transformative step towards human cosmic evolution and the mastery of nature.'),
        question('p4-4', 'What was One Village, One Grove?', ['A vaccination campaign', 'A school program', 'Africa’s first campaign against desertification, planting several million trees', 'A network of canals'], 2, 'The program planted several million trees in Africa’s first campaign against desertification.'),
        question('p4-5', 'What happened to the average yield of wheat per hectare between 1982 and 1986, according to the lesson?', ['It rose from 1,700 kg to 3,800 kg', 'It fell by half', 'It stayed at 1,700 kg', 'It rose from 3,800 kg to 5,000 kg'], 0, 'Land distributed amongst the peasantry led to the average yield rising from 1,700kg of wheat per hectare in 1982 to 3,800kg by 1986.'),
      ],
    ),
    lesson(
      'projects-501',
      5,
      '501: Preservation after death and Cybersyn',
      'The early cryonic attempt on Lenin, the modern one on FM-2030, and Chile’s Project Cybersyn.',
      12,
      [
        [
          'Early Cryonic attempt on Lenin & Preservation Upon Death (USSR)',
          'The Proto-Transhumanist demand to preserve and bring back Lenin upon his death was an immediate necessity, with Biocosmists-Immortalists in Petrograd stating: ‘the consciousness of the workers and the oppressed all over the world could never reconcile itself with the fact of Lenin’s death’ in their magazine called ‘Immortality’. In addition to the demand, the “Commission for the Immortalization of Lenin’s Memory” was created. An effort heavily driven and influenced by Soviet officials like Leonid Krasin who championed the scientific preservation of Lenin’s body in line with Russian Cosmist and Biocosmist beliefs.',
        ],
        [
          'Modern Cryonic attempt on FM-2030 (USA)',
          'The cryonic preservation of FM-2030 upon his death in 2000 was driven by the transhumanist belief that biological death is merely a temporary technical failure rather than an absolute boundary, directly inheriting the philosophical ethos of Russian Cosmism and Biocosmists. Just as early 20th-century Cosmists and Biocosmists viewed the physical preservation of Vladimir Lenin as an imperative mission to defeat biological decay until future science could resurrect him, FM-2030 treated his own body as an indispensable vessel meant to bridge the gap between present mortality and advanced regenerative technology. By becoming the first person to undergo advanced chemical vitrification at the Alcor Life Extension Foundation, FM-2030 updated the Cosmist “common task” into an individualized, modern protocol, resting in deep liquid-nitrogen suspension in anticipation of futuristic medical biotechnology, nanotechnology, and artificial intelligence capable of conquering disease and reversing cellular aging.',
        ],
        [
          'Project Cybersyn (Chile)',
          'The Socialist President of Chile undertook the pioneering project called ‘Project Cybersyn’, a distributed decision support system for decentralized economic planning. The project consisted of four modules: a network of telex machines (Cybernet) in all state-run enterprises that would transmit and receive information with the government in Santiago. Information from the field would be fed into statistical modeling software (Cyberstride) that would monitor production indicators, such as raw material supplies or high rates of worker absenteeism, in “almost” real time, alerting the workers in the first case and, in abnormal situations, if those parameters fell outside acceptable ranges by a very large degree, also the central government. The information would also be input into an economic simulation software (CHECO) which featured filtering and control settings that the government could use to forecast the possible outcome of economic decisions. Finally, an operations room (Opsroom) would provide a space where managers could see relevant economic data, formulate feasible responses to emergencies, and transmit advice and directives to enterprises and factories in alarm situations by using the telex network.',
        ],
      ],
      [
        question('p5-1', 'Which commission was created after Lenin’s death, according to the lesson?', ['The Commission for Foreign Trade', 'The Commission for the Immortalization of Lenin’s Memory', 'The State Planning Commission', 'The Commission for Space'], 1, 'In addition to the demand to preserve Lenin, the “Commission for the Immortalization of Lenin’s Memory” was created.'),
        question('p5-2', 'In what year did FM-2030 die and undergo cryonic preservation?', ['1924', '1957', '2030', '2000'], 3, 'FM-2030 was cryonically preserved upon his death in 2000.'),
        question('p5-3', 'What was FM-2030 the first person to undergo at the Alcor Life Extension Foundation?', ['Advanced chemical vitrification', 'A blood transfusion', 'A mind upload', 'Embalming'], 0, 'FM-2030 became the first person to undergo advanced chemical vitrification at the Alcor Life Extension Foundation.'),
        question('p5-4', 'What was Project Cybersyn?', ['A Soviet rocket program', 'A Cuban medical school', 'A distributed decision support system for decentralized economic planning in Chile', 'A tree-planting campaign'], 2, 'Project Cybersyn was a distributed decision support system for decentralized economic planning.'),
        question('p5-5', 'Which Cybersyn module was the network of telex machines in all state-run enterprises?', ['Cybernet', 'Cyberstride', 'CHECO', 'Opsroom'], 0, 'Cybernet was the network of telex machines; Cyberstride did the statistical modeling, CHECO the economic simulation, and the Opsroom was the operations room.'),
      ],
    ),
  ],
};
