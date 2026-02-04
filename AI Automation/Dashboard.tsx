import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './Dashboard.css';

interface TestResult {
  storyId: string;
  testCaseCount: number;
  generatedFilePath: string;
  testCases: Array<{
    id: string;
    name: string;
  }>;
}

interface GeneratedTest {
  name: string;
  path: string;
  createdAt: string;
}

const Dashboard: React.FC = () => {
  const [storyId, setStoryId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [generatedTests, setGeneratedTests] = useState<GeneratedTest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'generate' | 'list'>('generate');
  const [selectedTest, setSelectedTest] = useState<string | null>(null);
  const [testContent, setTestContent] = useState<string | null>(null);

  const API_URL = 'http://localhost:3000/api';

  // Fetch generated tests on mount
  useEffect(() => {
    fetchGeneratedTests();
  }, []);

  const fetchGeneratedTests = async () => {
    try {
      const response = await axios.get(`${API_URL}/tests`);
      setGeneratedTests(response.data.tests || []);
    } catch (err) {
      console.error('Error fetching tests:', err);
    }
  };

  const handleGenerateTests = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!storyId.trim()) {
      setError('Please enter a Story number');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await axios.post(`${API_URL}/generate-tests`, {
        storyId: storyId.toUpperCase(),
      });

      setResult(response.data.data);
      setStoryId('');

      // Refresh list
      await fetchGeneratedTests();
    } catch (err: any) {
      setError(
        err.response?.data?.error || 'Error occurred while generating tests'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleViewTest = async (testName: string) => {
    try {
      const testId = testName.replace('.spec.ts', '');
      const response = await axios.get(`${API_URL}/tests/${testId}`);
      setTestContent(response.data.content);
      setSelectedTest(testName);
    } catch (err: any) {
      setError('Could not load test content');
    }
  };

  const handleDeleteTest = async (testName: string) => {
    if (!confirm(`Do you want to delete ${testName}?`)) return;

    try {
      const testId = testName.replace('.spec.ts', '');
      await axios.delete(`${API_URL}/tests/${testId}`);
      await fetchGeneratedTests();
      setError(null);
    } catch (err: any) {
      setError('Could not delete the test');
    }
  };

  return (
    <div className="dashboard">
      <header className="header">
        <h1>🚀 JIRA Test Automation Dashboard</h1>
        <p>Integrated system for automatically generating Playwright tests from JIRA</p>
      </header>

      <div className="container">
        {/* Tabs */}
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'generate' ? 'active' : ''}`}
            onClick={() => setActiveTab('generate')}
          >
            📝 Generate Tests
          </button>
          <button
            className={`tab ${activeTab === 'list' ? 'active' : ''}`}
            onClick={() => setActiveTab('list')}
          >
            📋 Generated Tests ({generatedTests.length})
          </button>
        </div>

        {/* Error Message */}
        {error && <div className="alert alert-error">{error}</div>}

        {/* Generate Tab */}
        {activeTab === 'generate' && (
          <div className="card">
            <h2>Generate New Tests</h2>
            <form onSubmit={handleGenerateTests}>
              <div className="form-group">
                <label htmlFor="storyId">Story Number:</label>
                <input
                  id="storyId"
                  type="text"
                  placeholder="e.g.: SE2-69114"
                  value={storyId}
                  onChange={(e) => setStoryId(e.target.value)}
                  disabled={loading}
                  className="input"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary"
              >
                {loading ? '⏳ Processing...' : '✨ Generate Tests'}
              </button>
            </form>

            {/* Success Message */}
            {result && (
              <div className="alert alert-success">
                <h3>✅ Completed Successfully!</h3>
                <p>Story ID: {result.storyId}</p>
                <p>Number of Test Cases: {result.testCaseCount}</p>
                <p>📁 File: {result.generatedFilePath}</p>

                <div className="test-cases">
                  <h4>Test Cases:</h4>
                  <ul>
                    {result.testCases.map((tc) => (
                      <li key={tc.id}>
                        {tc.id} - {tc.name}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleViewTest(`${result.storyId}.spec.ts`)}
                  >
                    👀 View Code
                  </button>
                  <button
                    className="btn btn-info"
                    onClick={() => alert('You can now run the test using: npx playwright test')}
                  >
                    ▶️ Run Test
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* List Tab */}
        {activeTab === 'list' && (
          <div className="card">
            <h2>Generated Tests</h2>
            {generatedTests.length === 0 ? (
              <p className="empty-state">
                No generated tests yet. Start by generating a new test!
              </p>
            ) : (
              <div className="tests-grid">
                {generatedTests.map((test) => (
                  <div key={test.name} className="test-card">
                    <h3>{test.name}</h3>
                    <p className="test-date">
                      📅 {new Date(test.createdAt).toLocaleDateString('ar-EG')}
                    </p>
                    <div className="test-actions">
                      <button
                        className="btn btn-sm btn-info"
                        onClick={() => handleViewTest(test.name)}
                      >
                        👀 View
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDeleteTest(test.name)}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Test Content Viewer */}
        {testContent && (
          <div className="card">
            <div className="code-header">
              <h3>📄 {selectedTest}</h3>
              <button
                className="btn btn-sm"
                onClick={() => {
                  navigator.clipboard.writeText(testContent);
                  alert('Code copied!');
                }}
              >
                📋 Copy
              </button>
            </div>
            <pre className="code-block">
              <code>{testContent}</code>
            </pre>
          </div>
        )}
      </div>

      <footer className="footer">
        <p>🔧 JIRA Test Automation System | Version 1.0.0</p>
        <p>API Server: <code>http://localhost:3000</code></p>
      </footer>
    </div>
  );
};

export default Dashboard;
