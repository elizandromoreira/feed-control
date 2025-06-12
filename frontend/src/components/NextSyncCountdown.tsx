import React, { useState, useEffect } from 'react';
import './NextSyncCountdown.css';

interface NextSyncCountdownProps {
  isActive: boolean;
  intervalHours: number | null;
  lastSync: string | null;
}

interface TimeComponents {
  hours: number;
  minutes: number;
  seconds: number;
}

export const NextSyncCountdown: React.FC<NextSyncCountdownProps> = ({ 
  isActive, 
  intervalHours, 
  lastSync 
}) => {
  const [timeComponents, setTimeComponents] = useState<TimeComponents | null>(null);
  
  useEffect(() => {
    // If schedule is not active or we don't have interval or last sync, don't calculate
    if (!isActive || !intervalHours || !lastSync) {
      setTimeComponents(null);
      return;
    }
    
    const calculateTimeRemaining = () => {
      const lastSyncDate = new Date(lastSync);
      const nextSyncDate = new Date(lastSyncDate.getTime() + intervalHours * 60 * 60 * 1000);
      const now = new Date();
      
      let timeDiff = 0;
      
      // If next sync is in the past, calculate from now
      if (nextSyncDate < now) {
        // Find the next sync time based on the current time
        const hoursSinceLastSync = (now.getTime() - lastSyncDate.getTime()) / (60 * 60 * 1000);
        const completedIntervals = Math.floor(hoursSinceLastSync / intervalHours);
        const nextSyncTime = new Date(lastSyncDate.getTime() + (completedIntervals + 1) * intervalHours * 60 * 60 * 1000);
        
        timeDiff = nextSyncTime.getTime() - now.getTime();
      } else {
        // Next sync is in the future
        timeDiff = nextSyncDate.getTime() - now.getTime();
      }
      
      updateTimeComponents(timeDiff);
    };
    
    const updateTimeComponents = (timeDiff: number) => {
      if (timeDiff <= 0) {
        setTimeComponents(null);
        return;
      }
      
      // Convert to hours, minutes, seconds
      const hours = Math.floor(timeDiff / (1000 * 60 * 60));
      const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((timeDiff % (1000 * 60)) / 1000);
      
      // Update time components for animation
      setTimeComponents({
        hours,
        minutes,
        seconds
      });
    };
    
    // Calculate immediately
    calculateTimeRemaining();
    
    // Update every second
    const intervalId = setInterval(calculateTimeRemaining, 1000);
    
    return () => clearInterval(intervalId);
  }, [isActive, intervalHours, lastSync]);
  
  if (!isActive || !intervalHours || !timeComponents) {
    return null;
  }
  
  // Format digits with leading zeros
  const formatDigit = (digit: number): string => {
    return digit < 10 ? `0${digit}` : `${digit}`;
  };
  
  // Determine text color based on remaining time
  const getTimeColor = () => {
    const totalSeconds = timeComponents.hours * 3600 + timeComponents.minutes * 60 + timeComponents.seconds;
    if (totalSeconds < 60) return 'countdown-urgent'; // Less than 1 minute
    if (totalSeconds < 300) return 'countdown-warning'; // Less than 5 minutes
    return '';
  };
  
  return (
    <span className="digital-countdown ml-1">
      (em<span className="timer-spacer"></span><span className={`timer-digits ${getTimeColor()}`}>
        {timeComponents.hours > 0 && (
          <>
            <span className="digit-group">{formatDigit(timeComponents.hours)}</span>
            <span className="digit-separator">:</span>
          </>
        )}
        <span className="digit-group">{formatDigit(timeComponents.minutes)}</span>
        <span className="digit-separator">:</span>
        <span className="digit-group">{formatDigit(timeComponents.seconds)}</span>
      </span>)
    </span>
  );
};
