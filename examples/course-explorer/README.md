# Course explorer

A query of the public course api (design §10.8), and a page that shows what it answers. `query.mjs` asks an election
site for its course map and each published course's `ustp.course` file, and writes them as one JSON file;
`index.html` runs the same query from the browser, or opens that file, and shows it three ways:

- **Form**: the JSON as a read-only form. Each object is a group and each list a numbered group, each value a labelled
  field of its type (a long text a box, true or false a checkbox, a link one click away, a time also in local time),
  the right choice of each quiz question marked. Hover a label for its JSON path.
- **JSON**: what the api answered, highlighted, to copy or download.
- **Lessons**: every lesson of every course read: its text, its video, and its quiz with the right answers and their
  explanations, which can be hidden to test yourself. A search finds words in the lessons and quizzes.

`course-site/` shows the courses as a learner takes them; this shows them as data, what the api gives and in what shape.

## The query

Node 18 or later, nothing to install:

```sh
node query.mjs                                     # every published course on ustpvote2-dev.web.app, to stdout
node query.mjs --out courses.json                  # the same, to a file index.html opens
node query.mjs --course transhumanism              # one course
node query.mjs --course transhumanism --version 1  # an earlier published version of it
node query.mjs --site https://another-election-site
```

It reads the course map, then each published course's file (a draft on the map has none), and writes:

```json
{
  "site": "https://ustpvote2-dev.web.app",
  "queriedAt": "2026-11-01T17:40:00.000Z",
  "query": { "course": null, "version": null },
  "courseMap": { "courses": [{ "courseId": "transhumanism", "published": true, "lessonCount": 6, "prerequisites": [], "…": "…" }] },
  "packages": { "transhumanism": { "format": "ustp.course", "version": 1, "course": {}, "lessons": [], "profiles": [] } }
}
```

with a line for each course on stderr: its version, lessons, questions, minutes and futurist profiles.

The same requests need no Node: they are open to anyone, with no key or sign-in.

```sh
curl https://ustpvote2-dev.web.app/v1/public/courses
curl https://ustpvote2-dev.web.app/v1/public/courses/transhumanism/package
curl "https://ustpvote2-dev.web.app/v1/public/courses/transhumanism/package?version=1"
```

```powershell
Invoke-RestMethod https://ustpvote2-dev.web.app/v1/public/courses | ConvertTo-Json -Depth 10
```

The routes, and what each answers, are in [`course-site/README.md`](../course-site/README.md#what-it-reads).

## The page

Open `index.html` from anywhere: a file on your computer, GitHub Pages, any static host. It queries
`https://ustpvote2-dev.web.app` for every published course when it opens. The address can ask for another site, one
course, an earlier version, or a tab:

```text
index.html?site=https://ustpvote2-dev.web.app
index.html?course=transhumanism#lessons
index.html?course=transhumanism&version=1#json
```

Above the tabs, **Showing** picks what they show: the whole result, the course map, or one course's file. The query's
requests are listed with their status, time and size, with the `query.mjs` command that makes the same query. **Open a
JSON file** shows a file `query.mjs` saved, a `ustp.course` file a Course Administrator exported, or a course map,
with no request at all.
