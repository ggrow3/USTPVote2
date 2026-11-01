import { lessonsOf, question, type SeededCourse } from './lessons.js';

const COURSE_ID = 'fundamental-questions';
const lesson = lessonsOf(COURSE_ID);

/** Basics of Transhumanism 101 to 501, from the party's curriculum. */
export const fundamentalQuestions: SeededCourse = {
  courseId: COURSE_ID,
  title: 'The Fundamental Questions of Transhumanism',
  summary:
    'Basics of Transhumanism 101 to 501: what transhumanism is and why it is needed, whether it is “unnatural”, whether it is a project for the wealthy, implicit and explicit transhumanism, and why a left wing transhumanism.',
  placement: null,
  lessons: [
    lesson(
      'basics-101',
      1,
      '101: What is transhumanism?',
      'What transhumanism is, why it is needed, and how politics decides the research that improves human lives.',
      8,
      [
        [
          'What Is Transhumanism?',
          'Transhumanism is an ideology that advocates for the use of technology to overcome human limitations. This can include using medication to prevent illness, prosthetics to enhance mobility, cochlear implants to improve hearing, or even something as simple as using a phone to send messages. All of these things would not exist if not for the implicit use of technology to overcome human limitations. Any use of technology that expands human abilities can be considered Transhumanism.',
        ],
        [
          'Why Transhumanism?',
          'Even though technology is used at every level of society to overcome limitations, Transhumanism is needed due to its recognition of the inherent relationship between advancements in science/technology and improvements in human life and quality. Certain regions of the world during certain historical periods had an average life expectancy of around 30 years. Today, however, it has increased to approximately 77 years, largely due to technological progress.',
        ],
        [
          'Politics & Transhumanism',
          'Research is often paid for by the government through agencies like the NIH, which has helped create things like AIDS medications, antidepressants, etc. How much money goes toward research depends on whoever is in charge at the time. If the political will is there, that funding can make a real difference, helping people live longer, healthier lives and tackling big problems like hunger, homelessness, lack of healthcare, the mental health crisis, and even tackling aging itself.',
        ],
      ],
      [
        question('b1-1', 'What does transhumanism advocate, according to this lesson?', ['Leaving the human body as nature made it', 'Using technology to overcome human limitations', 'Replacing people with machines', 'Keeping technology for experts only'], 1, 'Transhumanism is an ideology that advocates for the use of technology to overcome human limitations.'),
        question('b1-2', 'Which of these does the lesson give as an example of overcoming a human limitation with technology?', ['Writing a letter by hand', 'Walking to work', 'Using a phone to send messages', 'Planting a garden'], 2, 'Medication, prosthetics, cochlear implants and even a phone used to send messages are all uses of technology to overcome human limitations.'),
        question('b1-3', 'Why is transhumanism needed, even though technology is already used at every level of society?', ['It recognizes the relationship between advances in science and technology and improvements in human life', 'It wants to slow new technology down', 'It replaces the need for research', 'It is the only way to make medicine'], 0, 'Transhumanism is needed due to its recognition of the inherent relationship between advancements in science and technology and improvements in human life and quality.'),
        question('b1-4', 'Where some regions in some periods had an average life expectancy of around 30 years, about how long is it today, according to the lesson?', ['About 45 years', 'About 60 years', 'About 120 years', 'About 77 years'], 3, 'Today it has increased to approximately 77 years, largely due to technological progress.'),
        question('b1-5', 'What decides how much money goes toward research, according to the lesson?', ['A law that never changes', 'Whoever is in charge at the time', 'Private companies alone', 'Nobody: it is always the same'], 1, 'Research is often paid for by the government through agencies like the NIH, and how much goes toward it depends on whoever is in charge at the time.'),
      ],
    ),
    lesson(
      'basics-201',
      2,
      '201: Is it unnatural?',
      'Whether using technology to change ourselves is “unnatural”, whether human nature can change, and what automating work does to it.',
      8,
      [
        [
          'Is using technology to change ourselves “unnatural”?',
          'Almost everything humans do to survive and thrive today can be considered “unnatural” in a strict sense. Wearing glasses to see, taking antibiotics to fight infections, drinking filtered water, or riding in cars are all technological interventions. Transhumanism is an ideology that simply points out and recognizes that humans have always used tools to overcome limitations of all types, and modern science is just a step in that long human tradition.',
        ],
        [
          'What about human nature? Is it changeable?',
          'Human nature is not a rigid biological blueprint, but a reflection of the economic system people live and function under. The perception of greed, competition, and hierarchy as “natural” exists only because capitalism forces humans to act selfishly just to survive. History proves that for millions of years, humans lived communally and cooperatively without money or bosses. Claiming modern capitalist behavior is unchangeable “human nature” is an unscientific claim that simply turns a temporary economic system into a permanent unchangeable excuse.',
        ],
        [
          'Automation of Work and Human Nature',
          'Coercive labor under capitalism, where work is done just to avoid starvation, not creative self-expression, hinders people; in other words, work for the sake of work is needless. Automating essential positions in the workplace doesn’t destroy human nature; it liberates it. When technology handles mandatory work, human effort shifts from forced production to voluntary things such as art, science, exploration, and community care. Automation will allow for the fulfilling of creative potential rather than crushing it.',
        ],
      ],
      [
        question('b2-1', 'How does the lesson answer the charge that changing ourselves with technology is “unnatural”?', ['It agrees, and says we should stop', 'It says only the newest technology counts', 'Humans have always used tools to overcome limitations, and modern science is a step in that tradition', 'It says nature has no limits to overcome'], 2, 'Transhumanism points out that humans have always used tools to overcome limitations of all types, and modern science is just a step in that long human tradition.'),
        question('b2-2', 'Which everyday acts does the lesson call technological interventions?', ['Wearing glasses, taking antibiotics, drinking filtered water and riding in cars', 'Only brain implants and gene editing', 'Only space travel', 'None: it says everyday life is natural'], 0, 'Wearing glasses to see, taking antibiotics to fight infections, drinking filtered water, or riding in cars are all technological interventions.'),
        question('b2-3', 'According to the lesson, what is human nature a reflection of?', ['A rigid biological blueprint', 'The economic system people live and function under', 'The climate people are born in', 'Nothing that can be studied'], 1, 'Human nature is not a rigid biological blueprint, but a reflection of the economic system people live and function under.'),
        question('b2-4', 'What does the lesson say history proves about how humans lived for millions of years?', ['They always competed in markets', 'They lived under strict hierarchies', 'They lived alone', 'They lived communally and cooperatively, without money or bosses'], 3, 'History proves that for millions of years, humans lived communally and cooperatively without money or bosses.'),
        question('b2-5', 'What does the lesson say automating essential work does to human nature?', ['It liberates it, shifting effort to voluntary things such as art, science, exploration and community care', 'It destroys it', 'It leaves people nothing to do', 'It makes work compulsory'], 0, 'Automating essential positions doesn’t destroy human nature; it liberates it, as human effort shifts from forced production to voluntary things.'),
      ],
    ),
    lesson(
      'basics-301',
      3,
      '301: A project for the wealthy?',
      'Transhumanism’s left wing history, how the wealthy changed it, and how anti-aging is seen under capitalism.',
      8,
      [
        [
          'Is Transhumanism a project for the wealthy to live forever?',
          'On the contrary, Transhumanism has a Left wing history going back to the founder of its precursor ideology, Russian Cosmism, dating back to the late 19th century and into the 20th century. If it was not for Socialism and the USSR, along with the revolutionary environment it created, Russian Cosmism may have never caught on as a way of thinking. Currently, the ones who are mainly thought of when one hears Transhumanists are capitalists, but that can be changed if the left takes back Transhumanism.',
        ],
        [
          'How did the wealthy change/influence Transhumanism?',
          'The long time progressive figure, James Hughes, detailed the political currents in transhumanism, particularly the shift around 2009 from socialist transhumanism to libertarian and anarcho-capitalist transhumanism. He claims that the left was pushed out of the World Transhumanist Association Board of Directors, and that libertarians and Singularitarians have secured a hegemony in the transhumanism community with help from Peter Thiel.',
        ],
        [
          'Sentiments towards Anti-Aging under Capitalism',
          'With longevity becoming one of the biggest buzzwords in wellness, the idea of longevity in the US has gone from living longer or even forever to living better. That is, staying mentally sharp, remaining independent, having energy, and continuing to do the things they find joy in is now more important than living longer. While healthy aging needs to be more accessible to the general population, the notion of quality over quantity seems to be a collective response to low quality of life and general instability of the general population. Living longer in a society where survival is a daily struggle will create an environment where a ‘good life’ is merely being healthy through it all as opposed to extending life in such a condition.',
        ],
      ],
      [
        question('b3-1', 'To which precursor ideology does the lesson trace transhumanism’s left wing history?', ['Extropianism', 'Russian Cosmism', 'Italian Futurism', 'Utilitarianism'], 1, 'Transhumanism has a left wing history going back to the founder of its precursor ideology, Russian Cosmism, from the late 19th century into the 20th.'),
        question('b3-2', 'According to the lesson, what might Russian Cosmism never have done without Socialism and the USSR?', ['Caught on as a way of thinking', 'Reached the Moon', 'Been written down', 'Influenced any artists'], 0, 'If it was not for Socialism and the USSR, along with the revolutionary environment it created, Russian Cosmism may have never caught on as a way of thinking.'),
        question('b3-3', 'Around what year, according to James Hughes, did transhumanism shift from socialist to libertarian and anarcho-capitalist transhumanism?', ['1957', '1990', '2020', '2009'], 3, 'Hughes detailed the shift around 2009 from socialist transhumanism to libertarian and anarcho-capitalist transhumanism.'),
        question('b3-4', 'Who does Hughes say helped libertarians and Singularitarians secure a hegemony in the transhumanist community?', ['Bill Gates', 'Jeff Bezos', 'Peter Thiel', 'Bryan Johnson'], 2, 'He claims that libertarians and Singularitarians have secured a hegemony in the transhumanism community with help from Peter Thiel.'),
        question('b3-5', 'How has the idea of longevity in the US changed, according to the lesson?', ['From living better to living forever', 'From living longer or even forever to living better', 'It has not changed', 'From health to wealth'], 1, 'Staying mentally sharp, independent and active is now more important than living longer, which the lesson sees as a response to low quality of life and general instability.'),
      ],
    ),
    lesson(
      'basics-401',
      4,
      '401: Implicit and explicit transhumanism',
      'Technologies adopted without the ideology, the open advocacy of it, and why the first does not make the second redundant.',
      8,
      [
        [
          'Implicit Transhumanism',
          '‘Implicit Transhumanism’ refers to the gradual, societal adoption of technologies that modify human capabilities without people identifying with transhumanism as an ideology or at all. Transhumanism in ‘practice’, in other words, includes medication such as birth control or laser eye surgery, pacemakers, the use of smartphones, etc. As an indirect result of implicit transhumanism the global average life expectancy has more than doubled since 1900. Since the 1990s life extension has hit a ceiling that an ‘explicit transhumanism’ seeks to address.',
        ],
        [
          'Explicit Transhumanism',
          '‘Explicit Transhumanism’ is the intentional act and advocacy of using technology or the collective means of humanity to overcome limitations. Organizations like the Transhumanist Party, groups like Left Transhumanism, and institutions like IEET (Institute for Ethics and Emerging Technologies) can be seen as Transhumanist through their advocacy. Through a transhumanist lens in politics, the ‘limits’ of humanity can be pushed back via funding different kinds of research, implementing certain programs, and achieving new heights in human progress.',
        ],
        [
          'Does implicit transhumanism make explicit transhumanism redundant?',
          'No. Implicit adoption lacks the necessary direct recognition of humanity’s relationship with technology. Rather, implicit adoption works with what is invented, produced, and marketed. It is a more consumption driven approach to transhumanism, void of any questions of asking where these technologies will take the human species and how they would impact systemic issues like morphological freedom, surveillance, existential risks, and various forms of inequality.',
        ],
      ],
      [
        question('b4-1', 'What is ‘implicit transhumanism’?', ['Joining a transhumanist party', 'The gradual adoption of technologies that modify human capabilities, without people identifying with transhumanism', 'Refusing every new technology', 'Science fiction about the future'], 1, 'Implicit transhumanism is the gradual, societal adoption of technologies that modify human capabilities without people identifying with transhumanism as an ideology.'),
        question('b4-2', 'As an indirect result of implicit transhumanism, what has happened to the global average life expectancy since 1900?', ['It has more than doubled', 'It has fallen', 'It has stayed the same', 'It has risen by about a year'], 0, 'As an indirect result of implicit transhumanism, the global average life expectancy has more than doubled since 1900.'),
        question('b4-3', 'Which of these does the lesson say can be seen as transhumanist through their advocacy?', ['Smartphone makers', 'Pacemaker manufacturers', 'Every hospital', 'The Transhumanist Party, Left Transhumanism and the IEET'], 3, 'Organizations like the Transhumanist Party, groups like Left Transhumanism, and institutions like the IEET can be seen as transhumanist through their advocacy.'),
        question('b4-4', 'Does implicit transhumanism make explicit transhumanism redundant, according to the lesson?', ['Yes: adoption is enough', 'Yes, because markets ask where technology will take us', 'No: implicit adoption lacks direct recognition of humanity’s relationship with technology', 'Only in the United States'], 2, 'Implicit adoption lacks the necessary direct recognition of humanity’s relationship with technology; it works with what is invented, produced and marketed.'),
        question('b4-5', 'Which questions does the lesson say a consumption driven approach leaves unasked?', ['What the technologies cost', 'Where these technologies will take the human species, and how they bear on morphological freedom, surveillance, existential risks and inequality', 'Which colors they come in', 'How to advertise them'], 1, 'Implicit adoption is void of any questions of where these technologies will take the human species and how they would impact morphological freedom, surveillance, existential risks and inequality.'),
      ],
    ),
    lesson(
      'basics-501',
      5,
      '501: Why left transhumanism?',
      'What an explicit left wing transhumanism changes, why ‘left’, and the future of transhumanism.',
      8,
      [
        [
          'How does an explicit Left Wing Transhumanism change anything?',
          'Explicit transhumanism shifts the development of technology from a reactive market driven process into a deliberate, politically conscious project. While implicit transhumanism simply adopts technologies as consumer goods, an explicit Left Wing Transhumanism directly questions the long-term destination of humanity, interrogating how emerging tools impact morphological freedom, surveillance, systemic inequality, or existential risk. It transforms various limitations from accepted natural baselines into sites of intentional social choice and ethical struggle.',
        ],
        [
          'Why ‘Left’ Transhumanism?',
          'Left transhumanism unites socialist political theory with overcoming the various limitations and challenges faced by humanity, arguing that genuine human emancipation requires both dismantling capitalist property relations and overcoming limits like different societal issues, aging, disease, and death. Grounded in Marx’s concept of human mastery over nature and the early Soviet Cosmists/Biocosmists, it frames natural mortality and biological decay as ultimate forms of inequality. Unlike other transhumanists, who treat enhancement as an individual market commodity, left transhumanists insist that advancing technology must occur within a socialized framework to liberate collective human potential.',
        ],
        [
          'The Future of Transhumanism',
          'The future of Transhumanism is the future of Left Transhumanism. To influence the Transhumanist community in a leftward direction requires a general left wing view to be the average within the Transhumanist community itself. That task alone is an uphill battle but not impossible. Transhumanism is a socially progressive ideology with an anti-capitalist history, giving a type of left leaning flexibility. Therefore, inroads already exist in Left Transhumanism’s favor with groups, organizations/institutions, and third parties reaching out for partnerships, coordination, and cooperation. We can lose nothing from trying!',
        ],
      ],
      [
        question('b5-1', 'What does explicit transhumanism change about the development of technology?', ['It leaves it entirely to the market', 'It stops it', 'It makes it a deliberate, politically conscious project rather than a reactive, market driven process', 'It keeps it secret'], 2, 'Explicit transhumanism shifts the development of technology from a reactive market driven process into a deliberate, politically conscious project.'),
        question('b5-2', 'Left transhumanism argues that genuine human emancipation requires what?', ['Only overcoming aging', 'Both dismantling capitalist property relations and overcoming limits like aging, disease and death', 'Only dismantling capitalist property relations', 'Neither: emancipation is already won'], 1, 'Genuine human emancipation requires both dismantling capitalist property relations and overcoming limits like societal issues, aging, disease, and death.'),
        question('b5-3', 'How does left transhumanism frame natural mortality and biological decay?', ['As ultimate forms of inequality', 'As good for society', 'As matters for religion only', 'As problems already solved'], 0, 'Grounded in Marx and the early Soviet Cosmists and Biocosmists, it frames natural mortality and biological decay as ultimate forms of inequality.'),
        question('b5-4', 'How do left transhumanists differ from transhumanists who treat enhancement as an individual market commodity?', ['They oppose all enhancement', 'They want enhancement sold at higher prices', 'They do not differ', 'They insist technology must advance within a socialized framework, to liberate collective human potential'], 3, 'Left transhumanists insist that advancing technology must occur within a socialized framework to liberate collective human potential.'),
        question('b5-5', 'What does the lesson say already exists in Left Transhumanism’s favor?', ['A majority in every transhumanist group', 'Inroads: groups, organizations, institutions and third parties reaching out for partnerships', 'Government funding', 'Nothing yet'], 1, 'Inroads already exist in Left Transhumanism’s favor, with groups, organizations/institutions, and third parties reaching out for partnerships, coordination, and cooperation.'),
      ],
    ),
  ],
};
