// Import Node.js Dependencies
import path from "path";
import os from "os";
import timers from "timers/promises";

// Import Third-party Dependencies
import { runASTAnalysisOnFile } from "@nodesecure/js-x-ray";
import pacote from "pacote";
import ntlp from "@nodesecure/ntlp";

// Import Internal Dependencies
import {
  getTarballComposition,
  isSensitiveFile,
  filterDependencyKind,
  analyzeDependencies,
  booleanToFlags,
  NPM_TOKEN,
  getSemVerWarning
} from "./utils/index.js";
import * as manifest from "./manifest.js";

// CONSTANTS
const kNativeCodeExtensions = new Set([".gyp", ".c", ".cpp", ".node", ".so", ".h"]);
const kJsExtname = new Set([".js", ".mjs", ".cjs"]);

export async function scanJavascriptFile(dest, file, packageName) {
  const result = await runASTAnalysisOnFile(path.join(dest, file), { packageName });

  const warnings = result.warnings.map((curr) => Object.assign({}, curr, { file }));
  if (!result.ok) {
    return {
      file,
      warnings,
      isMinified: false,
      tryDependencies: [],
      dependencies: [],
      filesDependencies: []
    };
  }
  const { packages, files } = filterDependencyKind(result.dependencies, path.dirname(file));

  return {
    file,
    warnings,
    isMinified: result.isMinified,
    tryDependencies: [...result.dependencies.getDependenciesInTryStatement()],
    dependencies: packages,
    filesDependencies: files
  };
}

export async function scanDirOrArchive(name, version, options) {
  const { ref, location = process.cwd(), tmpLocation, locker, registry } = options;

  const isNpmTarball = !(tmpLocation === null);
  const dest = isNpmTarball ? path.join(tmpLocation, `${name}@${version}`) : location;
  const free = await locker.acquireOne();

  try {
    // If this is an NPM tarball then we extract it on the disk with pacote.
    if (isNpmTarball) {
      await pacote.extract(ref.flags.includes("isGit") ? ref.gitUrl : `${name}@${version}`, dest, {
        ...NPM_TOKEN,
        registry,
        cache: `${os.homedir()}/.npm`
      });
      await timers.setImmediate();
    }
    else {
      // Set links to an empty object because theses are generated only for NPM tarballs
      Object.assign(ref, { links: {} });
    }

    // Read the package.json at the root of the directory or archive.
    const {
      packageDeps,
      packageDevDeps,
      author,
      description,
      hasScript,
      hasNativeElements,
      nodejs,
      engines,
      repository,
      scripts,
      integrity
    } = await manifest.readAnalyze(dest);
    Object.assign(ref, {
      author, description, engines, repository, scripts, integrity
    });

    // Get the composition of the (extracted) directory
    const { ext, files, size } = await getTarballComposition(dest);
    if (files.length === 1 && files.includes("package.json")) {
      ref.warnings.push({
        kind: "empty-package",
        location: null,
        i18n: "sast_warnings.emptyPackage",
        severity: "Critical",
        source: "Scanner",
        experimental: false
      });
    }

    ref.size = size;
    ref.composition.extensions.push(...ext);
    ref.composition.files.push(...files);
    const hasBannedFile = files.some((path) => isSensitiveFile(path));
    const hasNativeCode = hasNativeElements || files.some((file) => kNativeCodeExtensions.has(path.extname(file)));

    // Search for minified and runtime dependencies
    // Run a JS-X-Ray analysis on each JavaScript files of the project!
    const fileAnalysisRaw = await Promise.allSettled(
      files
        .filter((name) => kJsExtname.has(path.extname(name)))
        .map((file) => scanJavascriptFile(dest, file, name))
    );

    const fileAnalysisResults = fileAnalysisRaw
      .filter((promiseSettledResult) => promiseSettledResult.status === "fulfilled")
      .map((promiseSettledResult) => promiseSettledResult.value);

    ref.warnings.push(...fileAnalysisResults.flatMap((row) => row.warnings));

    if (/^0(\.\d+)*$/.test(version)) {
      ref.warnings.push(getSemVerWarning(version));
    }

    const dependencies = [...new Set(fileAnalysisResults.flatMap((row) => row.dependencies))];
    const filesDependencies = [...new Set(fileAnalysisResults.flatMap((row) => row.filesDependencies))];
    const tryDependencies = new Set(fileAnalysisResults.flatMap((row) => row.tryDependencies));
    const minifiedFiles = fileAnalysisResults.filter((row) => row.isMinified).flatMap((row) => row.file);

    const {
      nodeDependencies, thirdPartyDependencies, subpathImportsDependencies, missingDependencies, unusedDependencies, flags
    } = analyzeDependencies(dependencies, { packageDeps, packageDevDeps, tryDependencies, nodeImports: nodejs.imports });

    ref.composition.required_thirdparty = thirdPartyDependencies;
    ref.composition.required_subpath = Object.fromEntries(subpathImportsDependencies);
    ref.composition.unused.push(...unusedDependencies);
    ref.composition.missing.push(...missingDependencies);
    ref.composition.required_files = filesDependencies;
    ref.composition.required_nodejs = nodeDependencies;
    ref.composition.minified = minifiedFiles;

    // License
    await timers.setImmediate();
    const licenses = await ntlp(dest);
    const uniqueLicenseIds = Array.isArray(licenses.uniqueLicenseIds) ? licenses.uniqueLicenseIds : [];
    ref.license = licenses;
    ref.license.uniqueLicenseIds = uniqueLicenseIds;

    ref.flags.push(...booleanToFlags({
      ...flags,
      hasNoLicense: uniqueLicenseIds.length === 0,
      hasMultipleLicenses: licenses.hasMultipleLicenses,
      hasMinifiedCode: minifiedFiles.length > 0,
      hasWarnings: ref.warnings.length > 0 && !ref.flags.includes("hasWarnings"),
      hasBannedFile,
      hasNativeCode,
      hasScript
    }));
  }
  catch {
    // Ignore
  }
  finally {
    free();
  }
}

export async function scanPackage(dest, packageName) {
  const { type = "script", name } = await manifest.read(dest);

  await timers.setImmediate();
  const { ext, files, size } = await getTarballComposition(dest);
  ext.delete("");

  // Search for runtime dependencies
  const dependencies = Object.create(null);
  const [minified, warnings] = [[], []];

  const JSFiles = files.filter((name) => kJsExtname.has(path.extname(name)));
  for (const file of JSFiles) {
    const result = await runASTAnalysisOnFile(path.join(dest, file), {
      packageName: packageName ?? name,
      module: type === "module"
    });

    warnings.push(...result.warnings.map((curr) => Object.assign({}, curr, { file })));
    if (!result.ok) {
      continue;
    }

    dependencies[file] = result.dependencies.dependencies;
    result.isMinified && minified.push(file);
  }

  await timers.setImmediate();
  const { uniqueLicenseIds, licenses } = await ntlp(dest);

  return {
    files: { list: files, extensions: [...ext], minified },
    directorySize: size,
    uniqueLicenseIds,
    licenses,
    ast: { dependencies, warnings }
  };
}
