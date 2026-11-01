@Library('linkurious-shared')_

nodeJob {
  // General
  projectName = "linkurious/dokapi"
  podTemplateNames = ['jnlp-agent-node']

  // Testing
  runUnitTests = true
  runE2eTests = false

  // Publish to the public npm registry (publishConfig.access = "public")
  runNpmPublish = true
  runPrivateNpmPublish = false

  abortPreviousBuild = true
  runForwardMerge = false

  // Tag the release and bump the patch version once released from master
  createGitTag = true
  gitTagPrefix = 'v'
  runBookeeping = true
}
