import {Composition} from 'remotion';
import {FlowPilotDemo} from './Demo';
import './styles.css';

export const RemotionRoot = () => (
  <Composition
    id="FlowPilotDemo"
    component={FlowPilotDemo}
    durationInFrames={4800}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{}}
  />
);
