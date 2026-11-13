# Course site

Another site built from the public course api (design §10.8): `index.html` is the whole site, one file with no build
and no server of its own. It lists the courses of an election site, and shows each published course from its
`ustp.course` file: the lessons with their videos, the quizzes, graded in the page from the file's answers, and the
futurist profiles with their credited portraits. Certificates stay on the course's own site, which each course links to.

To show a course on another site without building anything, frame the course embed instead: the election site's
Partners page (`/partners`) gives the `<iframe>` snippet for each course (design §10.17).

Open it from anywhere: a file on your computer, GitHub Pages, any static host. It reads
`https://ustpvote2-dev.web.app` unless the address names another site:

```text
index.html?site=https://ustpvote2-dev.web.app
index.html?site=https://ustpvote2-dev.web.app#/course/transhumanism
```

## What it reads

Everything comes from three public routes, which any site may read from a browser (they answer
`Access-Control-Allow-Origin: *`, and need no key or sign-in):

| Route | Gives |
|---|---|
| `GET /v1/public/courses` | the course map: every published course, and each draft on the map as coming soon, in map order, with its prerequisites and its square |
| `GET /v1/public/courses/{courseId}/package` | a published course as its `ustp.course` file (`?version=N` for an earlier version); 404 for a draft |
| `GET /v1/public/course-images/{sha256}` | an uploaded portrait, which a profile names by its `portraitImage`; a profile with a `portraitUrl` instead links to a picture elsewhere |

An uploaded lesson video plays from `/v1/public/videos/{videoId}`, and a YouTube video is named by its ID and start.
A copy must keep each portrait's credit and licence, which the file gives with it.

## With an AI assistant

The site's MCP server has the same courses as tools (`list_courses`, `get_course`; see
[`apps/mcp`](../../apps/mcp/README.md)), so an assistant can build a site of its own from them, for example: *"Using
ustp-vote, make a static website for the published courses, with every lesson, a quiz that checks answers in the
page, and the futurist profiles with their portrait credits."*
