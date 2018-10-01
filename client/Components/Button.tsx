import * as React from "react";

export interface ButtonProps {
    text?: string;
    fontAwesomeIcon?: string;
    tooltip?: string;
    additionalClassNames?: string;
    disabled?: boolean;
    onClick: React.MouseEventHandler<HTMLSpanElement>;
    onMouseOver?: React.MouseEventHandler<HTMLSpanElement>;
}

export class Button extends React.Component<ButtonProps> {
    public render() {
        const text = this.props.text || "";
        
        const disabled = this.props.disabled || false;
    
        const classNames = ["c-button"];

        if (disabled) {
            classNames.push("c-button--disabled");
        }
        if (this.props.additionalClassNames) {
            classNames.push(this.props.additionalClassNames);
        }

        const faElement = this.props.fontAwesomeIcon && <span className={`fas fa-${this.props.fontAwesomeIcon}`} />;

        return <span
            className={classNames.join(" ")}
            onClick={!disabled && this.props.onClick}
            onMouseOver={!disabled && this.props.onMouseOver}
            title={this.props.tooltip}
        >{faElement}{text}</span>;
    }
}