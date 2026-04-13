import React from 'react';
import DayTrading from './DayTrading';

export default function Live() {
  return <DayTrading liveOnly autoRefreshMs={60000} />;
}