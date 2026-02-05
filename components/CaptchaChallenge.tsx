import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CaptchaDifficulty } from '../types';

interface CaptchaChallengeProps {
    onVerify: (solution: string, expected: string) => Promise<{ success: boolean; error?: string }>;
    onSuccess: (difficulty: CaptchaDifficulty) => void;
    onStart: () => void;
    onMilestone: (distance: number) => void;
    onGameOver?: (score: number) => void;
    onScoreUpdate?: (score: number) => void;
    onSessionRewardUpdate?: (reward: number) => void;
    isMining: boolean;
}

const GAME_CONFIG = {
    [CaptchaDifficulty.EASY]: { speed: 6, gravity: 0.6, jumpStrength: -16, gapMin: 150, gapMax: 300, winScore: 500 },
    [CaptchaDifficulty.MEDIUM]: { speed: 7, gravity: 0.6, jumpStrength: -17, gapMin: 120, gapMax: 250, winScore: 1000 },
    [CaptchaDifficulty.HARD]: { speed: 8, gravity: 0.7, jumpStrength: -18, gapMin: 100, gapMax: 220, winScore: 2000 },
};

const CHARACTER_SIZE = 240;
const OBSTACLE_WIDTH = 40;
const OBSTACLE_HEIGHT = 60;

const CaptchaChallenge: React.FC<CaptchaChallengeProps> = ({ onVerify, onSuccess, onStart, onMilestone, onGameOver, onScoreUpdate, onSessionRewardUpdate, isMining }) => {
    const [difficulty, setDifficulty] = useState<CaptchaDifficulty>(CaptchaDifficulty.HARD);
    const [isExternalMining, setIsExternalMining] = useState(false); // Replaces 'loading' for UI state
    const [gameState, setGameState] = useState<'IDLE' | 'PLAYING' | 'GAME_OVER' | 'VICTORY'>('IDLE');
    const [score, setScore] = useState(0);
    const [highScore, setHighScore] = useState(0);
    const [volume, setVolume] = useState(0.3); // Default volume 30%


    // We'll define initGame first then use another useEffect if needed, 
    // or just handle state logic in the render/callbacks.

    // Let's use a trigger effect after initGame is defined.

    const [sessionReward, setSessionReward] = useState(0);
    const [rewardMessage, setRewardMessage] = useState<string | null>(null);
    const [characterPosition, setCharacterPosition] = useState({ x: 50, y: 0, grounded: true });

    // Update parent component with score changes
    useEffect(() => {
        if (onScoreUpdate) {
            onScoreUpdate(score);
        }
    }, [score, onScoreUpdate]);

    // Update parent component with session reward changes
    useEffect(() => {
        if (onSessionRewardUpdate) {
            onSessionRewardUpdate(sessionReward);
        }
    }, [sessionReward, onSessionRewardUpdate]);

    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

    useEffect(() => {
        const handleResize = () => {
            setCanvasSize({
                width: window.innerWidth,
                height: window.innerHeight
            });
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const requestRef = useRef<number>();

    // Game State Refs (for Loop)
    const characterRef = useRef({ x: 50, y: 0, dy: 0, grounded: true });
    const characterSpriteRef = useRef<HTMLImageElement | null>(null);
    const flagBgRef = useRef<HTMLImageElement | null>(null);
    const gameBackgroundRef = useRef<HTMLImageElement | null>(null);
    const mountainRockRef = useRef<HTMLImageElement | null>(null);
    const obstaclesRef = useRef<{ x: number; width: number; height: number; type: 'duststorm'; y: number; warned?: boolean }[]>([]);
    const scoreRef = useRef(0);
    const lastMilestoneRef = useRef(0);
    const speedRef = useRef(0);
    const configRef = useRef(GAME_CONFIG[CaptchaDifficulty.HARD]);

    // Dust storm effect state
    const dustStormRef = useRef({ active: false, opacity: 0, particles: [] as { x: number; y: number; speed: number; size: number }[] });
    const lastDustSpawnRef = useRef(0);
    const heartsRef = useRef<{ x: number; y: number; speed: number; size: number; opacity: number; phase: number }[]>([]);

    // Animation state
    const animationRef = useRef({ frame: 0, frameTime: 0, jumpRotation: 0 });

    const jumpAudio = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        // Load jump sound
        jumpAudio.current = new Audio('/dist/sounds/whale sound.mp3');

        // Load Character sprite (animated GIF)
        const charImg = new Image();
        charImg.src = '/character.gif';
        charImg.onload = () => { characterSpriteRef.current = charImg; };

        // Load Mars background
        const marsImg = new Image();
        marsImg.src = '/mars_background.png';
        marsImg.onload = () => { flagBgRef.current = marsImg; };

        // Load game background image
        const bgImg = new Image();
        bgImg.src = '/game_background.jpg';
        bgImg.onload = () => { gameBackgroundRef.current = bgImg; };

        // Load mountain rock obstacle sprite
        const rockImg = new Image();
        rockImg.src = '/mountain_rock.png';
        rockImg.onload = () => { mountainRockRef.current = rockImg; };

        // Initialize dust particles
        const particles = [];
        for (let i = 0; i < 100; i++) {
            particles.push({
                x: Math.random() * 800,
                y: Math.random() * 500,
                speed: Math.random() * 3 + 2,
                size: Math.random() * 4 + 1
            });
        }
        dustStormRef.current.particles = particles;
        // Initialize heart particles
        const hearts = [];
        for (let i = 0; i < 40; i++) {
            hearts.push({
                x: Math.random() * 800,
                y: Math.random() * 500,
                speed: Math.random() * 0.8 + 0.4,
                size: Math.random() * 15 + 10,
                opacity: Math.random() * 0.4 + 0.2,
                phase: Math.random() * Math.PI * 2
            });
        }
        heartsRef.current = hearts;
    }, []);

    const playSound = (audio: HTMLAudioElement | null) => {
        if (audio) {
            audio.volume = volume;
            audio.currentTime = 0;
            audio.play().catch(e => console.error("Sound play failed:", e));
        }
    };

    // Frame Rate Independence
    const lastFrameTimeRef = useRef<number>(0);

    const initGame = useCallback(() => {
        configRef.current = GAME_CONFIG[difficulty];
        characterRef.current = { x: 50, y: 150 - CHARACTER_SIZE, dy: 0, grounded: true };
        obstaclesRef.current = [];
        scoreRef.current = 0;
        lastMilestoneRef.current = 0;
        speedRef.current = configRef.current.speed;
        lastFrameTimeRef.current = performance.now(); // Reset time
        setScore(0);
        setSessionReward(0);
        setGameState('PLAYING');
    }, [difficulty]);

    // ... (useEffect for mining/idle stays same)
    useEffect(() => {
        if (isMining && gameState === 'IDLE') {
            initGame();
        } else if (!isMining && gameState !== 'IDLE') {
            setGameState('IDLE');
        }
    }, [isMining, initGame]);

    const jump = useCallback(() => {
        if (gameState !== 'PLAYING') {
            if (gameState !== 'VICTORY') initGame();
            return;
        }
        const p = characterRef.current;
        if (p.grounded) {
            // Jump strength does NOT need dt scaling if applied instantaneously as velocity, 
            // but gravity handling usually implies consistent units. 
            // Standard approach: Velocity is pixels/frame @ 60fps.
            p.dy = configRef.current.jumpStrength;
            p.grounded = false;
            playSound(jumpAudio.current); // Play whale sound on jump
        }
    }, [gameState, initGame]);

    const keysPressed = useRef<{ [key: string]: boolean }>({});

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if typing in an input or textarea
            if (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                return;
            }

            keysPressed.current[e.code] = true;

            if (e.code === 'Space') {
                e.preventDefault();
                if (gameState === 'IDLE') {
                    onStart();
                } else if (gameState === 'GAME_OVER') {
                    initGame();
                } else if (gameState === 'PLAYING') {
                    jump();
                }
            } else if (e.code === 'ArrowUp' && gameState === 'PLAYING') {
                e.preventDefault();
                jump();
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            keysPressed.current[e.code] = false;
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [jump, gameState, onStart, initGame]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const loop = (timestamp: number) => {
            if (!lastFrameTimeRef.current) lastFrameTimeRef.current = timestamp;
            const deltaTime = timestamp - lastFrameTimeRef.current;
            lastFrameTimeRef.current = timestamp;

            // Target 60 FPS (approx 16.67ms per frame)
            // dtFactor will be ~1.0 for 60hz, ~0.5 for 120hz, ~0.25 for 240hz
            // We cap dt to avoid huge jumps if tab is inactive
            const dt = Math.min(deltaTime, 100) / 16.67;

            const width = canvas.width;
            const height = canvas.height;
            // Position ground lower on the cracked road surface to sync with road edge
            const groundY = Math.floor(height * 0.85);
            const cfg = configRef.current;

            const isPlaying = gameState === 'PLAYING';

            // 1. Dynamic Speed
            if (isPlaying) {
                if (speedRef.current < 13) {
                    speedRef.current += 0.001 * dt; // Scale acceleration
                }
            }

            // Update Character
            const p = characterRef.current;

            if (isPlaying) {
                // Variable Gravity
                const gravity = cfg.gravity;

                p.dy += gravity * dt; // Scale gravity
                p.y += p.dy * dt;     // Scale velocity application

                // Ground Collision
                if (p.y + CHARACTER_SIZE >= groundY) {
                    p.y = groundY - CHARACTER_SIZE;
                    p.dy = 0;
                    p.grounded = true;
                }
            } else if (gameState === 'IDLE') {
                p.y = groundY - CHARACTER_SIZE;
                p.dy = 0;
                p.grounded = true;
            }

            // Move Obstacles
            if (isPlaying) {
                obstaclesRef.current.forEach(obs => {
                    const moveSpeed = speedRef.current;
                    obs.x -= moveSpeed * dt; // Scale movement
                });
                if (obstaclesRef.current.length > 0 && obstaclesRef.current[0].x < -100) {
                    obstaclesRef.current.shift();
                }
            }

            // Obstacle Spawning relies on distance, which relies on Score.
            // Score usually increments by speed. 
            if (isPlaying) {
                scoreRef.current += speedRef.current * dt; // Scale score increment
                // The rest of logic uses limits based on scoreRef, so it auto-adjusts.

                const currentDistM = Math.floor(scoreRef.current / 50);


                // Mars Dust Storm Spawning logic
                const lastObs = obstaclesRef.current[obstaclesRef.current.length - 1];

                // Increased gap between obstacles for higher jumps
                const minGap = Math.min(speedRef.current * 70, 600);
                const variance = Math.random() * 250 + 100; // 100-350 extra spacing

                // Failsafe: If no obstacles, force spawn immediately
                const shouldSpawn = !lastObs || (width - lastObs.x > minGap + variance);

                if (shouldSpawn) {
                    const h = Math.floor(Math.random() * 30) + 35;
                    const mainObsWidth = OBSTACLE_WIDTH + 15;
                    obstaclesRef.current.push({
                        x: width,
                        width: mainObsWidth,
                        height: h,
                        type: 'duststorm',
                        y: groundY - h,
                        warned: false
                    });

                    // Add chance for "double" obstacle - requires "big jump"
                    if (Math.random() < 0.2 && scoreRef.current > 300) { // 20% chance, only after some score
                        const secondH = Math.floor(Math.random() * 30) + 35;
                        obstaclesRef.current.push({
                            x: width + mainObsWidth + 5, // Tiny 5px gap for "joined" look
                            width: mainObsWidth,
                            height: secondH,
                            type: 'duststorm',
                            y: groundY - secondH,
                            warned: false
                        });
                    }
                }

            }

            // Collision Detection
            if (isPlaying) {
                // Character hitbox - focus on the lower body/feet area
                const horizontalMargin = CHARACTER_SIZE * 0.25; // 25% margin on sides
                const topMargin = CHARACTER_SIZE * 0.4; // 40% margin on top (head can pass over)
                const bottomMargin = CHARACTER_SIZE * 0.05; // Small margin at feet

                const crash = obstaclesRef.current.some(obs => {
                    // Character hitbox (lower portion - the body/legs area)
                    const px = p.x + horizontalMargin;
                    const py = p.y + topMargin;
                    const pw = CHARACTER_SIZE - (horizontalMargin * 2);
                    const ph = CHARACTER_SIZE - topMargin - bottomMargin;

                    // Obstacle Hitbox - reasonable size for fair collision
                    const ox = obs.x + (obs.width * 0.15);
                    const oy = obs.y + (obs.height * 0.1);
                    const ow = obs.width * 0.7;
                    const oh = obs.height * 0.8;

                    return (
                        px < ox + ow &&
                        px + pw > ox &&
                        py < oy + oh &&
                        py + ph > oy
                    );
                });

                if (crash) {
                    setGameState('GAME_OVER');
                    if (scoreRef.current > highScore) setHighScore(Math.floor(scoreRef.current));
                    if (onGameOver) onGameOver(scoreRef.current);
                    return; // Stop updating
                }
            }

            // Update Score
            if (isPlaying) {
                scoreRef.current += speedRef.current;
                setScore(Math.floor(scoreRef.current));

                const distance = Math.floor(scoreRef.current / 50);
                const milestone = Math.floor(distance / 100) * 100;

                if (milestone > 0 && milestone > lastMilestoneRef.current) {
                    onMilestone(milestone);
                    lastMilestoneRef.current = milestone;

                    // Sync UI state
                    let added = 0;
                    if (milestone === 100) added = 0.00081;
                    else if (milestone === 200) added = 0.0011;
                    else if (milestone === 300) added = 0.0012;
                    else if (milestone === 400) added = 0.0016;
                    else if (milestone === 500) added = 0.0032;
                    else if (milestone > 500) {
                        added = 0.0016;
                    }
                    setSessionReward(prev => prev + added);
                    setRewardMessage(`+${added.toFixed(4)} SOL`);
                    setTimeout(() => setRewardMessage(null), 3000);
                    speedRef.current += 0.5;
                }
            }

            // Drawing
            const drawBackground = () => {
                // Clear canvas
                ctx.clearRect(0, 0, width, height);

                // Draw the game background image if loaded
                if (gameBackgroundRef.current) {
                    // Scale and fill the canvas while maintaining aspect ratio
                    const img = gameBackgroundRef.current;
                    const imgAspect = img.width / img.height;
                    const canvasAspect = width / height;

                    let drawWidth, drawHeight, drawX, drawY;

                    if (canvasAspect > imgAspect) {
                        // Canvas is wider than image
                        drawWidth = width;
                        drawHeight = width / imgAspect;
                        drawX = 0;
                        drawY = (height - drawHeight) / 2;
                    } else {
                        // Canvas is taller than image
                        drawHeight = height;
                        drawWidth = height * imgAspect;
                        drawX = (width - drawWidth) / 2;
                        drawY = 0;
                    }

                    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
                } else {
                    // Fallback background color
                    ctx.fillStyle = '#2d3748';
                    ctx.fillRect(0, 0, width, height);
                }
            };

            drawBackground();

            // No ground line needed - using the platform road from background image

            // Draw Obstacles - Mountain rock sprites
            obstaclesRef.current.forEach(obs => {
                if (obs.type === 'duststorm') {
                    // Draw mountain rock sprite if loaded, otherwise fallback to simple shape
                    if (mountainRockRef.current) {
                        // Scale sprite to match obstacle dimensions - 1.3x bigger
                        const spriteWidth = obs.width * 2.925; // 1.3x bigger (was 2.25)
                        const spriteHeight = obs.height * 2.34; // 1.3x bigger (was 1.8)
                        ctx.drawImage(
                            mountainRockRef.current,
                            obs.x - (spriteWidth - obs.width) / 2, // Center the wider sprite
                            groundY - spriteHeight,
                            spriteWidth,
                            spriteHeight
                        );
                    } else {
                        // Fallback: simple rock shape if sprite not loaded
                        ctx.save();
                        ctx.translate(obs.x, groundY);
                        ctx.fillStyle = '#6a5a4a';
                        ctx.beginPath();
                        ctx.moveTo(0, 0);
                        ctx.lineTo(obs.width * 0.5, -obs.height);
                        ctx.lineTo(obs.width, 0);
                        ctx.closePath();
                        ctx.fill();
                        ctx.restore();
                    }
                }
            });

            // Update character position state for the animated GIF overlay
            setCharacterPosition({ x: p.x, y: p.y, grounded: p.grounded });

            // Overlays
            if (gameState === 'IDLE') {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.fillRect(0, 0, width, height);

                // Draw "Press Space to Start" text
                ctx.font = 'bold 20px "JetBrains Mono"';
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.fillText('PRESS SPACE TO START', width / 2, height / 2 + 8);
            } else if (gameState === 'GAME_OVER') {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.fillRect(0, 0, width, height);

                // Draw "Press Space to Restart" text
                ctx.font = 'bold 20px "JetBrains Mono"';
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.fillText('PRESS SPACE TO RESTART', width / 2, height / 2 + 8);
            } else if (gameState === 'VICTORY') {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.fillRect(0, 0, width, height);
                ctx.font = 'bold 20px "JetBrains Mono"';
                ctx.fillStyle = '#10b981';
                ctx.textAlign = 'center';
                ctx.fillText('VALIDATION COMPLETE', width / 2, height / 2);
            }

            // Progress Bar (Only when playing or game over)
            if (gameState !== 'IDLE') {
                const currentCycleScore = scoreRef.current % cfg.winScore;
                const progress = Math.min(currentCycleScore / cfg.winScore, 1);

                ctx.fillStyle = '#3f3f46';
                ctx.fillRect(0, 0, width, 4);

                if (scoreRef.current > 0 && scoreRef.current % cfg.winScore < 100) {
                    ctx.fillStyle = '#22c55e';
                } else {
                    ctx.fillStyle = '#10b981';
                }
                ctx.fillRect(0, 0, width * progress, 4);
            }


            requestRef.current = requestAnimationFrame(loop);
        };

        requestRef.current = requestAnimationFrame(loop);
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [gameState, difficulty, onSuccess, onVerify, highScore, canvasSize]);



    return (
        <div className="relative w-full h-full">
            <canvas
                ref={canvasRef}
                width={canvasSize.width}
                height={canvasSize.height}
                className={`w-full h-full bg-zinc-900 transition-all duration-300 cursor-pointer
                    ${gameState === 'GAME_OVER' ? 'border-red-500/50' : gameState === 'VICTORY' ? 'border-green-500/50' : ''}
                `}
            />

            {rewardMessage && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 animate-in zoom-in slide-in-from-bottom-5 duration-500">
                    <div className="bg-black/50 backdrop-blur-sm px-4 py-2 rounded-xl border border-green-500/50">
                        <span className="text-xl font-black text-[#4ade80] drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] tracking-wider">
                            {rewardMessage}
                        </span>
                    </div>
                </div>
            )}

            {/* Animated Character GIF Overlay */}
            <img
                src="/character.gif"
                alt="Character"
                className="absolute pointer-events-none"
                style={{
                    left: characterPosition.x,
                    top: characterPosition.y,
                    width: CHARACTER_SIZE,
                    height: CHARACTER_SIZE,
                    filter: characterPosition.grounded ? 'none' : 'drop-shadow(0 8px 4px rgba(0,0,0,0.3))',
                    transition: 'filter 0.1s ease',
                }}
            />

            {/* Shadow under character */}
            {characterPosition.grounded && (
                <div
                    className="absolute pointer-events-none rounded-full"
                    style={{
                        left: characterPosition.x + CHARACTER_SIZE * 0.1,
                        top: characterPosition.y + CHARACTER_SIZE * 0.9,
                        width: CHARACTER_SIZE * 0.8,
                        height: CHARACTER_SIZE * 0.15,
                        backgroundColor: 'rgba(0,0,0,0.3)',
                        filter: 'blur(4px)',
                    }}
                />
            )}

            {/* Game Info Overlay - Removed from canvas, now in Dashboard */}
        </div>
    );
};

export default CaptchaChallenge;
