// src/components/MarqueeText.jsx
import React, { useState, useEffect, useRef } from 'react';
import './MarqueeText.css';

const MarqueeText = ({ text, speed = 40, className = '' }) => {
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const animationRef = useRef(null);
  const [position, setPosition] = useState(0);

  useEffect(() => {
    const checkOverflow = () => {
      if (containerRef.current && textRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const textWidth = textRef.current.scrollWidth;
        setIsOverflowing(textWidth > containerWidth);
        
        // Reset position jika tidak overflow
        if (textWidth <= containerWidth) {
          setPosition(0);
          if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
          }
        }
      }
    };

    checkOverflow();
    window.addEventListener('resize', checkOverflow);

    return () => {
      window.removeEventListener('resize', checkOverflow);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [text]);

  useEffect(() => {
    if (!isOverflowing || isPaused) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    let lastTime = 0;
    let animationId = null;

    const animate = (timestamp) => {
      if (!lastTime) lastTime = timestamp;
      const delta = timestamp - lastTime;
      
      if (delta >= 16) { // ~60fps
        lastTime = timestamp;
        const containerWidth = containerRef.current?.offsetWidth || 0;
        const textWidth = textRef.current?.scrollWidth || 0;
        
        setPosition(prev => {
          let newPos = prev + (speed * delta / 1000);
          // Reset ke awal jika sudah mencapai ujung
          if (newPos > textWidth) {
            newPos = -containerWidth;
          }
          return newPos;
        });
      }
      
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);
    animationRef.current = animationId;

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationRef.current = null;
      }
    };
  }, [isOverflowing, isPaused, speed]);

  if (!text) return null;

  return (
    <div 
      className={`marquee-container ${className}`}
      ref={containerRef}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div
        className="marquee-content"
        ref={textRef}
        style={{
          transform: isOverflowing ? `translateX(${-position}px)` : 'translateX(0)',
          whiteSpace: isOverflowing ? 'nowrap' : 'normal',
        }}
      >
        {text}
        {isOverflowing && (
          <span className="marquee-separator"> • </span>
        )}
        {isOverflowing && text}
      </div>
    </div>
  );
};

export default MarqueeText;