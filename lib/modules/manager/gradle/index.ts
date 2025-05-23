import type { Category } from '../../../constants';
import { MavenDatasource } from '../../datasource/maven';
import * as gradleVersioning from '../../versioning/gradle';

export { extractAllPackageFiles } from './extract';
export { updateDependency } from './update';
export { updateArtifacts } from './artifacts';

export const supportsLockFileMaintenance = true;

export const url =
  'https://docs.gradle.org/current/userguide/getting_started_dep_man.html';
export const categories: Category[] = ['java'];

export const defaultConfig = {
  managerFilePatterns: [
    '/\\.gradle(\\.kts)?$/',
    '/(^|/)gradle\\.properties$/',
    '/(^|/)gradle/.+\\.toml$/',
    '/(^|/)buildSrc/.+\\.kt$/',
    '/\\.versions\\.toml$/',
    // The two below is for gradle-consistent-versions plugin
    `/(^|/)versions.props$/`,
    `/(^|/)versions.lock$/`,
  ],
  timeout: 600,
  versioning: gradleVersioning.id,
};

export const supportedDatasources = [MavenDatasource.id];
