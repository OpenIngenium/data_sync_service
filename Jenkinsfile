pipeline {
    agent any
    stages {
        stage('Determine Branch and Execute Jobs') {
            steps {
                script {
                    def commitHash = env.GIT_COMMIT // Get the current commit hash

                    if (env.BRANCH_NAME == 'devel') {
                        // This block runs only for the 'devel' branch
                        echo "Running on 'devel' branch"
                        
                        stage('Build Image for Devel') {
                            echo "Building image for 'devel' branch"
                            build job: 'Ingenium/build_image', 
                            parameters: [
                                string(name: 'REPO', value: 'data_sync_service'),
                                string(name: 'REPO_BRANCH', value: 'devel')
                            ]
                        }

                        stage('Update CI ANALYTICS Image for Devel') {
                            echo "Updating CI image for 'devel' branch"
                            build job: 'Ingenium/update_ci_analytics_image', 
                            parameters: [
                                string(name: 'REPO', value: 'data_sync_service'),
                                string(name: 'REPO_BRANCH', value: 'devel')
                            ]
                        }

                    } else {
                        // This block runs for any other branch (including PRs)
                        echo "Running on branch '${env.BRANCH_NAME}', which is not 'devel'"

                        stage('Build Image for PR or Other Branch') {
                            echo "Building image for branch '${env.BRANCH_NAME}'"
                            build job: 'Ingenium/build_image', 
                            parameters: [
                                string(name: 'REPO', value: 'data_sync_service'),
                                string(name: 'REPO_TAG', value: commitHash)
                            ]
                        }

                        stage('Run Repo Tests for PR') {
                            echo "Running repo tests for branch '${env.BRANCH_NAME}'"
                            build job: 'Ingenium/run_repo_tests', 
                            parameters: [
                                string(name: 'REPO', value: 'data_sync_service'), 
                                booleanParam(name: 'ONLY_REPO_TESTS', value: true), 
                                string(name: 'REPO_TAG', value: commitHash), 
                                string(name: 'CLUSTER_BRANCH', value: 'devel')
                            ]
                        }
                    }
                }
            }
        }
    }
    post {
        success {
            script {
                if (env.BRANCH_NAME == 'devel') {
                    echo 'Build and update for "devel" branch completed successfully.'
                } else {
                    echo 'Build and tests for PR or other branches completed successfully.'
                }
            }
        }
        failure {
            script {
                if (env.BRANCH_NAME == 'devel') {
                    echo 'Build and update for "devel" branch failed.'
                } else {
                    echo 'Build and tests for PR or other branches failed.'
                }
            }
        }
        aborted {
            script {
                if (env.BRANCH_NAME == 'devel') {
                    echo 'Build and update for "devel" branch was aborted.'
                } else {
                    echo 'Build and tests for PR or other branches were aborted.'
                }
            }
        }
        cleanup {
            script {
                echo 'Cleaning up workspace...'
                cleanWs() // Clean up workspace after build or tests
            }
        }
    }
}
