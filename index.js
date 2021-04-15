const core = require('@actions/core')
// const github = require("@actions/github"); // Why does github.token not work???
const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')
const { graphql } = require('@octokit/graphql')

// https://docs.github.com/en/free-pro-team@latest/actions/creating-actions/creating-a-javascript-action

const header = {
  Accept: 'application/vnd.github.v3+json'
}

const providers = {
  BtbN: {
    url: 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases',
    regex: /ffmpeg-((n(?<version_n>[0-9.]+)-[0-9]+|N-(?<version_N>[0-9]+)))-(?<commit_id>[a-z0-9]+)-win64-gpl-shared-?([0-9.]+)?(?<!vulkan)\.zip/,
    allowedOptions: [
      'version', // Includes two types of versions.
      'commit_id'
    ],
    graphqlParams: {
      owner: 'BtbN',
      name: 'FFmpeg-Builds'
    }
  },
  'gyan.dev': {
    url: 'https://api.github.com/repos/GyanD/codexffmpeg/releases',
    regex: /ffmpeg-(?<version>.+?)(-(?<date>.+))?-full_build-shared\.zip/,
    allowedOptions: [
      'version',
      'date'
    ],
    graphqlParams: {
      owner: 'GyanD',
      name: 'codexffmpeg'
    }
  }
}

const MAXIMUM_RESULT_COUNT_PER_PAGE = 28

async function main () {
  try {
    const token = core.getInput('github_token', { required: true }) // It's secret.

    const providerName = core.getInput('provider', { required: true })
    const expectedVersion = core.getInput('filename_version')
    const expectedCommitId = core.getInput('filename_commit_id')
    const expectedDate = core.getInput('filename_build_date')
    const targetDir = core.getInput('target')

    core.debug(`provider = ${providerName}`)
    core.debug(`filename_version = ${expectedVersion}`)
    core.debug(`filename_commit_id = ${expectedCommitId}`)
    core.debug(`filename_build_date = ${expectedDate}`)
    core.debug(`target = ${targetDir}`)

    const targetPath = path.resolve(targetDir)
    core.debug(`resolvedTarget = ${targetPath}`)

    const providerInfo = providers[providerName]
    if (!providerInfo) { throw new Error(`No such provider: "${providerName}".`) }

    // https://stackoverflow.com/questions/42467500/how-to-get-the-total-release-number-of-github-projects-using-api
    let perPageResultNum, maximumPageNum
    {
      const { repository } = await graphql(
        `
          {
            repository(owner: "${providerInfo.graphqlParams.owner}", name: "${providerInfo.graphqlParams.name}") {
              refs(refPrefix: "refs/tags/", first: 0) {
                totalCount
              }
            }
          }
        `,
        {
          headers: {
            Authorization: `token ${token}`
          }
        }
      )
      core.debug(`repository = ${JSON.stringify(repository)}`)
      const releaseCount = repository.refs.totalCount
      core.debug(`releaseCount: ${releaseCount}`)
      perPageResultNum = releaseCount < MAXIMUM_RESULT_COUNT_PER_PAGE ? releaseCount : MAXIMUM_RESULT_COUNT_PER_PAGE
      maximumPageNum = Math.ceil(releaseCount / MAXIMUM_RESULT_COUNT_PER_PAGE)
    }
    core.debug(`perPageResultNum: ${perPageResultNum}`)
    core.debug(`maximumPageNum: ${maximumPageNum}`)

    const disallowedOptions = []
    if (expectedVersion === '') {
      disallowedOptions.push('version')
    }
    if (expectedCommitId === '') {
      disallowedOptions.push('commit_id')
    } else {
      if (!(providerInfo.allowedOptions.includes('commit_id'))) {
        throw new Error(`Provider "${providerName}" does not support the condition "filename_commit_id".`)
      }
    }
    if (expectedDate === '') {
      disallowedOptions.push('date')
    } else {
      if (!(providerInfo.allowedOptions.includes('date'))) { throw new Error(`Provider "${providerName}" does not support the condition "filename_build_date".`) }
    }
    core.debug(`disallowedOptions = [${disallowedOptions}]`)

    const allowedOptions = providerInfo.allowedOptions.filter((value, index, arr) =>
      !disallowedOptions.includes(value)
    )
    core.debug(`allowedOptions = [${allowedOptions}]`)

    const findLatestSharedBuild = allowedOptions.length === 0
    core.debug(`findLatestSharedBuild = ${findLatestSharedBuild}`)

    const regex = new RegExp(providerInfo.regex, 'i')
    let foundUrl = false
    let packageDownloadUrl = ''
    let fileName = ''

    for (let pageNum = 1; pageNum <= maximumPageNum; pageNum++) {
      const releasePageUrl = `${providerInfo.url}?per_page=${perPageResultNum}&page=${pageNum}`
      core.debug(`releasePageUrl = ${releasePageUrl}`)

      const releases = await fetch(releasePageUrl, {
        method: 'get',
        header: header
      })
        .then((res) => {
          core.debug(res.headers.raw())
          return res
        })
        .then((res) => {
          if (!res.ok) { throw new Error(`Fail to fetch JSON from "${releasePageUrl}": HTTP ${res.status}.`) }
          return res
        })
        .then((res) => res.json())
        .catch((err) => {
          throw new Error(`Fail to fetch JSON from "${releasePageUrl}": ${err}`)
        })

      for (const releaseIndex in releases) {
        const release = releases[releaseIndex]
        const assets = release.assets

        for (const assetIndex in assets) {
          const asset = assets[assetIndex]
          const name = asset.name
          core.debug(`[${releaseIndex}].assets[${assetIndex}].name: ${name}`)
          const match = name.match(regex)

          if (!match) {
            core.debug('The filename does not meet the requirements.')
            continue
          }

          const groups = match.groups
          const versionList = [
            groups.version, // gyan.dev
            groups.version_n, // BtbN
            groups.version_N // BtbN
          ]
          const commitId = groups.commit_id // BtbN
          const date = groups.date // gyan.dev

          if (findLatestSharedBuild) {
            core.debug(`Found latest shared build: [${versionList}] [${commitId}] [${date}].`)
            foundUrl = true
          } else {
            if (allowedOptions.includes('version')) {
              core.debug(`Version: [${versionList}] [${expectedVersion}]`)

              if (versionList.includes(expectedVersion)) {
                core.debug('Version matches.')
                foundUrl = true
              } else {
                core.debug('Version does not match.')
                foundUrl = false
                continue
              }
            }
            if (allowedOptions.includes('commit_id')) {
              core.debug(`Commit ID: [${commitId}] [${expectedCommitId}]`)

              if (`[${commitId}]` === `[${expectedCommitId}]`) {
                core.debug('Commit ID matches.')
                foundUrl = true
              } else {
                core.debug('Commit ID does not match.')
                foundUrl = false
                continue
              }
            }
            if (allowedOptions.includes('date')) {
              core.debug(`Build date: [${date}] [${expectedDate}]`)

              if (`[${date}]` === `[${expectedDate}]`) {
                core.debug('Build date matches.')
                foundUrl = true
              } else {
                core.debug('Build date does not match.')
                foundUrl = false
                continue
              }
            }
          }

          if (foundUrl) {
            fileName = name
            packageDownloadUrl = asset.browser_download_url
            core.debug(`[${releaseIndex}].assets[${assetIndex}].browser_download_url: ${packageDownloadUrl}`)
            break
          }
        }

        if (foundUrl) { break }
      }

      if (foundUrl) { break }
    }

    if (!foundUrl) {
      throw new Error('Cannot find the url.')
    } else {
      core.info(`fileName: ${fileName}`)
      core.info(`packageDownloadUrl: ${packageDownloadUrl}`)
    }

    const filePath = path.join(targetPath, fileName)
    core.info(`filePath: ${filePath}`)

    fs.mkdirSync(targetPath, {
      recursive: true
    })
    core.debug(`Target forder "${targetPath}" created.`)

    const buffer = await fetch(packageDownloadUrl)
      .then((res) => {
        core.debug(res.headers.raw())
        return res
      })
      .then((res) => {
        if (!res.ok) { throw new Error(`Fail to download file from "${packageDownloadUrl}": HTTP ${res.status}.`) }
        return res
      })
      .then((res) => res.buffer())
      .catch((err) => {
        throw new Error(`Fail to download file from "${packageDownloadUrl}": ${err}`)
      })
    core.info('Download completed.')

    fs.writeFileSync(filePath, buffer)
    core.info('File saved.')

    core.setOutput('fileName', fileName)
    core.setOutput('filePath', filePath)

    // The end.
  } catch (err) {
    core.setFailed(err.message)
  }
}

main()
