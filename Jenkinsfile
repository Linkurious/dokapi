@Library('linkurious-shared')_

nodeJob {
  // General
  projectName = "linkurious/dokapi"
  podTemplateNames = ['jnlp-agent-node']

  // Testing
  runUnitTests = true
  runE2eTests = false

  // Public npm on master (publishConfig.access = "public"),
  // private Nexus npm for preview / non-master builds
  runNpmPublish = true
  runPrivateNpmPublish = true

  abortPreviousBuild = true
  runForwardMerge = false

  // Tag the release and bump the patch version once released from master
  createGitTag = true
  gitTagPrefix = 'v'
  runBookeeping = true
}
