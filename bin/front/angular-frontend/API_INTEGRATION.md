# TestCaseGenie Angular - Backend API Integration

## Overview
Your Angular frontend is now fully configured to connect to your backend APIs. The application includes comprehensive API integration with proper error handling, connection monitoring, and configurable endpoints.

## API Configuration

### Backend Services
The application connects to two main backend services:

1. **Main Backend API (Port 5000)**
   - Test case generation
   - AI processing
   - Conversation history management

2. **Jira API Proxy (Port 8000)**
   - Jira issues retrieval
   - Components and sprints
   - Project management data

### Configuration Files

#### `ApiConfigService`
Located at: `src/app/services/api-config.service.ts`

```typescript
// Default configuration
BACKEND_API_URL: 'http://localhost:5000'
JIRA_API_URL: 'http://localhost:8000/api/jira'
JIRA_PROJECT_KEY: 'SE2'
JIRA_BOARD_ID: 942
```

To change these settings, update the configuration in the service or use the `updateConfig()` method.

## API Endpoints

### Backend API Endpoints (Port 5000)
- `POST /generate` - Generate test cases from Jira issues
- `GET /health` - Health check endpoint

### Jira API Endpoints (Port 8000)
- `GET /api/jira/test-cases/paginated` - Get paginated Jira issues
- `GET /api/jira/components` - Get project components
- `GET /api/jira/sprints/ordered` - Get ordered sprints
- `GET /api/jira/boards` - Get project boards
- `GET /api/jira/health` - Health check endpoint

## Services Architecture

### Core Services

1. **JiraService** (`src/app/services/jira.service.ts`)
   - Handles all Jira API communication
   - Manages issue filtering and pagination
   - Retrieves components, sprints, and boards

2. **TestCaseService** (`src/app/services/test-case.service.ts`)
   - Manages test case generation
   - Handles conversation history
   - Provides state management for test cases

3. **ConnectionStatusService** (`src/app/services/connection-status.service.ts`)
   - Monitors backend connectivity
   - Provides real-time connection status
   - Automatic health checks every 30 seconds

4. **ApiConfigService** (`src/app/services/api-config.service.ts`)
   - Centralized API configuration
   - Environment-specific settings
   - Easy endpoint management

## Connection Monitoring

The application includes real-time connection monitoring that:
- Checks backend connectivity every 30 seconds
- Displays connection status in the UI
- Shows color-coded status indicators
- Provides last-checked timestamps

## Error Handling

All API calls include comprehensive error handling:
- Automatic retry logic
- User-friendly error messages
- Console logging for debugging
- Graceful degradation when services are unavailable

## Starting Your Backend Services

To connect the Angular frontend to your backend:

1. **Start your main backend server on port 5000**
   ```bash
   # Navigate to your backend directory
   cd path/to/your/backend
   npm start
   ```

2. **Start your Jira API proxy on port 8000**
   ```bash
   # Navigate to your Jira proxy directory
   cd path/to/your/jira-proxy
   npm start
   ```

3. **Start the Angular development server**
   ```bash
   cd angular-frontend
   ng serve
   ```

## Testing the Connection

Once your backend services are running:

1. Open the Angular application at `http://localhost:4200`
2. Check the "Backend Connection Status" section
3. Green indicators mean successful connections
4. Red indicators mean the services are not reachable

## API Request Examples

### Generate Test Cases
```typescript
// The service automatically handles this
this.testCaseService.generateTestCases(jiraIssue).subscribe({
  next: (testCases) => {
    // Handle successful generation
  },
  error: (error) => {
    // Handle errors
  }
});
```

### Get Jira Issues
```typescript
// With filters
this.jiraService.getIssues({
  issueType: 'story',
  component: 'frontend',
  startAt: 0,
  maxResults: 50
}).subscribe({
  next: (response) => {
    // Handle issues
  },
  error: (error) => {
    // Handle errors
  }
});
```

## Customization

### Changing API URLs
Update the configuration in `ApiConfigService`:

```typescript
// In your component or service
this.apiConfig.updateConfig({
  BACKEND_API_URL: 'https://your-production-api.com',
  JIRA_API_URL: 'https://your-jira-proxy.com/api/jira'
});
```

### Adding New Endpoints
1. Add the endpoint to `ApiConfigService.endpoints`
2. Create methods in the appropriate service
3. Use the `getFullUrl()` method for consistent URL building

## Troubleshooting

### Common Issues

1. **CORS Errors**
   - Ensure your backend allows requests from `http://localhost:4200`
   - Add appropriate CORS headers

2. **Connection Refused**
   - Verify backend services are running
   - Check port numbers match configuration
   - Ensure no firewall blocking

3. **404 Errors**
   - Verify endpoint paths match your backend routes
   - Check API configuration settings

### Debug Mode
Enable console logging to see detailed API requests and responses in the browser developer tools.

## Next Steps

1. Start your backend services
2. Test the API connections
3. Verify data flow between frontend and backend
4. Customize endpoints as needed for your specific backend implementation

The Angular frontend is now fully prepared for backend integration! 🚀
