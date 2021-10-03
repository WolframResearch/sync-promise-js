# Development

Please read the [Contributing Agreement](../CONTRIBUTING.md) first. By contributing to this repository, you agree to the licensing terms herein.

To install all required dependencies for development of this library, run:

    yarn install

## Test

To run the tests:

    yarn test

## Releasing a new version

To release a new version, log in to npm using

    yarn login
    
as an owner of this package.

Check out the `master` branch and make sure there are no uncommitted changes:

    git checkout master
    
Then run

    yarn publish
    
which asks for the new package version, updates `package.json` accordingly, runs a build, creates a Git tag, and publishes the package.

If publishing fails due to missing authentication even though you have run `yarn login`, you might have to delete `~/.npmrc` and log in again (see [this Yarn issue](https://github.com/yarnpkg/yarn/issues/4709)).

If [two-factor authentication](https://docs.npmjs.com/configuring-two-factor-authentication) is enabled for your account, you will be asked for a one-time password during the publishing process.
