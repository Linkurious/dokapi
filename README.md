# Dokapi

A Markdown-based Website generator with awesome features.
Usage:
```
>npm install -g dokapi
>dokapi -i my/input/folder -o my/output/folder
```

Options:
- `-i` or `--input`: path of input folder.
- `-o` or `--output`: path to output folder.
- `-t` or `--type`: type of desired output (`site`  or `page`, default: `site`).
- `-w` or `--watch`: keep running and dynamicly regenerate output when input changes (watches input folder for changes).
- `-c` or `--create-missing`: automatically create missing referenced markdown files. 
- `-r` or `--refresh-project`: force to re-download in code project used to extract code comments (cached by default)

## Features

- [JSON-file configuration (a single `dokapi.json` file to configure everything)](#configuration-file-dokapijson);
- Automatic menu generation (Order of items in menu is defined in a JSON file);
- Stable URLs (Even when files get moves and/or renamed);
- [Variables interpolation with `{{mustache}}` syntax (use variables in your markdown files)](#using-variables);
- [Variable definition in your code (define variables in special `@dokapi` comments in your code)](#defining-variable-in-your-code);
- Uses [marky-markdown](https://github.com/npm/marky-markdown#what-it-does) to emulate Github-style markdown rendering;
- Code-coloring down with [Highlights](https://www.npmjs.com/package/highlights), enables easy CSS customization;
- Generate *multi-page* or *single-page* site with the same content;
- [Inject code files in your markdown](injecting-code-files-in-your-markdown-content) with `{{file:my_file.js}}`or `{{editfile:other_file.sh}}`;
- [Sanity checks](#sanity-checks) everywhere (never have a broken link of missing image in your site);
- [Watcher to dynamically re-generate your site when your content changed](#input-watcher);

## Configuration file: `dokapi.json` 

All paths are relative to the folder in which `dokapi.json` is located.

Example:
```json
{
  "name": "My Project Name",
  "project": "git@github.com:MyOrganisation/my-project.git#my-branch",
  "variables": {
    "my.variable.1": "foo",
    "my.var.2": "bar baz"
  },
  "assets": "media",
  "numbering": true,
  "externalLinksToBlank": true,
  "siteTemplate": "site-template.html",
  "pageTemplate": "page-template.html",
  "main": {
    "content": "main.md"
  },
  "index": [
    {
      "name": "Getting started",
      "children": [
        {"name": "Downloading", "key": "download", "content": "getting-started/download.md"},
        {"name": "Installing", "key": "install", "content": "getting-started/install.md"}
      ]
    },
    {
      "name": "Audit trail",
      "content": "audit-trail.md"
    }
  ]
}
``` 

- `name` (*required*): Name of the project (used as title of main entry);
- `variables` (*required*): A map of variable definitions;
- `assets` (*required*): Relative path to assets directory (used for CSS etc.), will be copied as-is;
- `siteTemplate` (*required*): Path to HTML template used for `type = "site"` (multi-page);
- `pageTemplate` (*required*): Path to HTML template used for `type = "page"` (single-page);
- `main` (*required*): Description of main site entry;
- `main.content` (*required*): Path to markdown file of main entry;
- `previousLink` (*default*: `"Previous"`): Text used in link to previous entry (when `type = "site"`); 
- `nextLink` (*default*: `"Next"`): Text used in link to next entry (when `type = "site"`) ;
- `main.name` (*default*: `"Introduction"`): Name of main entry in site-menu;
- `project`: GitHub-style URL or relative path to source-code project;
- `numbering`: Whether to use ordered (`<ol>`) or unordered (`<ul>`) tags when generating the site-menu;
- `externalLinksToBlank`: Whether to open external links in a new tab;
- `index`: Content structure
- `index.*.name` (*required*): Name of the entry;
- `index.*.key`: Key of the entry (when left out, will use lowercase name with all special chars replaced by hyphens);
- `index.*.content` (*optional* if the entry has children): Path to markdown file with content of the entry; 
- `index.*.hidden`: Whether to hide this entry (and its potential children entries) from the site-menu (internal links to this entry will work);  
- `index.*.children`: Children entries to current entry; 
- `index.*.children.*.name` (*required*): Name of the entry; 
- `index.*.children.*.key`: Key of the entry (when left out, will use lowercase name with all special chars replaced by hyphens); 
- `index.*.children.*.content` (*required*): Path to markdown file with content of the entry;

## Using variables

### Defining variables in `dokapi.json`
```JSON
"variables": {
  "version": "1.2.3"
}
```
will replace all `{{version}}` tags in all Markdown files and HTML templates.

### Defining variable in your code
Declare a source project in the configuration file like this:
```
"project": "git@github.com:Linkurious/Dokapi.git#main"
```

Dokapi will extract all specially formatted comments from the code:
```js
/**
 * @dokapi my.variable.name
 *
 * This is how to use the API:
 * ```js
 * // a code example
 * var a = 123;
 * bar b = myFunction(a, 0.5);
 * ```
 */
```

### Using variables in markdown
All variables will be available for injection:
```md
# Documentation about my API
This API is awesome.
{{my.variable.name}}
```

### Special variables

Some variables are automatically defined:

- `entry.key`: Key of the current entry (as defined in JSON file);
- `entry.title`: Title of the current entry (as defined in JSON file);
- `entry.root.path`: Relative path to root site directory for current entry;
- `entry.menu`: Inf the entry has children, list with links to children entries;

With `type = "site"`:

- `entry.previous`: HTML link to previous entry (text can be set using `config.previousLink`);
- `entry.next`: HTML link to next entry (text can be set using `config.nextLink`);
- `entry.html.body`: (in HTML template only), HTML of current entry;
- `menu`: (in HTML template only), HTML of current menu;

With `type = "page"`:

- `body`: In HTML `"page"` template only, HTML for all combined entries;

If you reference a code project, the following variables will be extracted from `package.json`:

- `package.name`;
- `package.description`;
- `package.version`;
- `package.license`;

## Injecting code files in your markdown content
 
Keep code and text separated by leaving your code examples in files separate from your markdown file.
Inject the content of a code file in your Markdown file with this easy syntax: 

- `{{file:file.js}}` for a `<code>` block;
- `{{editfile:file.js}}` for a `<textarea>` block.

Paths are relative to the markdown file containing the reference.

Variable in injected code files are interpolated.

## Sanity checks

Dokapi checks for everything that could go wrong with your documentation.

- Checks for broken internal links;
- Checks for missing images;
- Checks for potentially illegal image file names (enforce safe chars and no spaces);
- Checks for internal link collisions (multiple entries with same key);
- Checks for broken variable references (used but not defined, defined bot not used);
- Checks for unused code-block variables (defined in code but not used in site);
- Checks for unused markdown files (not referenced in structure);
- Checks for missing injected files (`{{file:missing_file.js}}` and `{{editfile:missing_file.js}}`);

## Input watcher

Use the `-w` flag to re-generate the site dynamically when anything in the input folder changes.
Example:
```sh
>dokapi -i my/input/folder -o my/output/folder -w

Watched folder changed...
 * Generated in 1.00s :)
```

## Okapis are awesome

![picture of an okapi](https://upload.wikimedia.org/wikipedia/commons/b/b5/Okapia_johnstoni01.jpg)
