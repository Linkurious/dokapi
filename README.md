# Dokapi

A Markdown-based Website generator with handy features.
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

## Automatic menu generation
Order of items in menu is defined in a JSON file.

## Stable URLs
Even when files get moves and/or renamed.

## Variables interpolation with `{{mustache}}` syntax

### Variables can de defined in JSON configuration file
```JSON
"variables": {
  "version": "1.2.3"
}
```
will replace all `{{version}}` tags in all Markdown files and HTML templates.

### Variables can be extracted from a code project
Declare a source project in the configuration file like:
```
"project": "git@github.com:Linkurious/Dokapi.git#main"
```

This will extract all specially formatted comments from the code:
```js
/**
 * @doc my.api.example
 *
 * This is how to use the API:
 * ```js
 * // a code example
 * var a = 123;
 * bar b = myFunction(a, 0.5);
 * ```
 */
```

These variables will be available for injection:
```md
# Documentation about my API
This API is awesome.
{{my.api.example}}
```

## Generate as multi-page or single-page

Two modes. You must provide a different template for each mode.

## Input watcher to re-generate output while working

Use the `-w` flag to re-generate the output when a file in input folder changes.

## Sanity checks everywhere

- checks for broken internal links
- checks for missing images
- checks for internal link collisions
- checks for broken variable references
- checks for unused code-block variables
- checks for unused markdown files (not referenced in structure)

## Okapis are awesome

![picture of an okapi](https://upload.wikimedia.org/wikipedia/commons/b/b5/Okapia_johnstoni01.jpg)
