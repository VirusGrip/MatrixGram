import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { UpdateNotice } from './UpdatesPanel';
import { NotificationRouter } from './NotificationRouter';
import './styles.css';
import './features.css';
import './messenger.css';
import './extras.css';
import './mobile-chat.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /><UpdateNotice/><NotificationRouter/></React.StrictMode>);
