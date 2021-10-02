# sync-promise-js

An efficient, complete promise implementation with synchronous promise resolution.

SyncPromise is compliant with the Promise/A+ spec, *except* [part 2.2.4](https://promisesaplus.com/#point-34).

## Why

Why synchronous promise resolution can be useful:

* Some APIs such as various clipboard operations in browsers still expect synchronous handling.
* Synchronous operations can be faster than operations that require a new execution context.

There exist some similar libraries, but they don't offer the same, complete promise API as this library:

* [sync-promise](https://www.npmjs.com/package/sync-promise)
* [synchronous-promise](https://www.npmjs.com/package/synchronous-promise)
* [syncpromise](https://www.npmjs.com/package/syncpromise)

## Installation

Assuming you are using a package manager such as [npm](https://www.npmjs.com/get-npm) or [Yarn](https://yarnpkg.com/en/), just install this package from the npm repository:

    npm install sync-promise-js

Then you can import `SyncPromise` in your JavaScript code:

    import SyncPromise from 'sync-promise-js';

## Example

    SyncPromise.race([
        SyncPromise.resolve('sync'),
        SyncPromise.delay(100).then(() => 'async')
    ]).then(result => {
        console.log(result);
        // will print 'sync' synchronously
    });

## Usage & Documentation

See the **[SyncPromise API documentation](docs/API.md)**.

## Contributing

Everyone is welcome to contribute. Please read the [Contributing agreement](CONTRIBUTING.md) and the [Development guide](./docs/Development.md) for more information, including how to run the tests.

## Versioning

We use [semantic versioning](https://semver.org/) for this library and its API.

See the [changelog](CHANGELOG.md) for details about the changes in each release.
