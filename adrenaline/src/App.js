import React, { Component } from 'react';
import { Configuration, OpenAIApi } from "openai";

import { OLD_CODE_LABEL, FIXED_CODE_LABEL, range, diffGPTOutput } from "./utilities";

import Header from "./containers/Header";
import CodeEditor from "./containers/CodeEditor";
import ErrorMessage from "./containers/ErrorMessage";
import ErrorExplanation from "./containers/ErrorExplanation";

import './App.css';

// TEMP: Testing only
const testInputCode = [
  "def apply_func_to_input(func, input):",
  "\tfunc(input)",
  "",
  "def main():",
  "\tmy_data = []",
  "\tfor i in range(10):",
  "\t\tapply_func_to_input(my_data.add, i)",
  "\t\tYOOOOO",
  "",
  "\tprint(my_data)",
  "",
  "main()"
];
const testGPTCode = [
  "def apply_func_to_input(func, input):",
  "\t# This will apply func to input",
  "\t(lambda: func(input))()",
  "",
  "def main():",
  "\tmy_data = []",
  "\tfor i in range(10):",
  "\t\tapply_func_to_input(my_data.append, i)",
  "",
  "\tprint(my_data)",
  "",
  "main()"
]
const testErrorExplanation = "The component also uses the split function to split the text into an array of words, and then uses the slice function to select a subset of the array up to the currentWordIndex. It then uses the join function to join this subset of words back into a single string of text, which is then rendered using the div element.";

const EDIT_PROMPT_PARAMS = {
  model: "code-davinci-edit-001"
};
const COMPLETION_PROMPT_PARAMS = {
  model: "text-davinci-003",
  max_tokens: 500,
  temperature: 0.2,
  top_p: 1,
  presence_penalty: 0,
  frequency_penalty: 0,
  best_of: 1,
  n: 1,
  stream: false
};
const DEFAULT_STATE = {
  language: "python",
  code: testInputCode,
  errorMessage: "",
  diffs: [],
  errorExplanation: "", // testErrorExplanation,
  apiKey: "",
  waitingForAPI: false
};
export default class App extends Component {
	constructor(props) {
		super(props);

    this.onCodeChange = this.onCodeChange.bind(this);
    this.onResolveDiff = this.onResolveDiff.bind(this);
    this.onDebug = this.onDebug.bind(this);
    this.onSelectLanguage = this.onSelectLanguage.bind(this);

		this.state = DEFAULT_STATE;
	}

  /* Event Handlers */

  onCodeChange(editor, data, newCode) {
    const { code, diffs } = this.state;
    newCode = newCode.split("\n")

    if (code.length !== newCode.length) {
      const { from, text, to } = data;

      if (from.line === to.line) { // Insertion
        let insertLine = from.line;
        let numLinesAdded = text.length - 1;

        diffs.forEach(diff => {
          const { oldLines, mergeLine, newLines } = diff;
          const lastLineInDiff = newLines.at(-1);

          // Insertions don't affect diffs *before* the insertLine
          if (lastLineInDiff < insertLine) {
            return;
          }

          if (oldLines.includes(insertLine)) { // Change occurred in old code
            let lastOldLine = oldLines.at(-1)
            diff.oldLines.push(...range(numLinesAdded, lastOldLine + 1));

            diff.mergeLine += numLinesAdded;
            diff.newLines = newLines.map(line => line + numLinesAdded);
          } else if (mergeLine === insertLine || newLines.includes(insertLine)) { // Change occurred in new code
            let lastNewLine = newLines.at(-1);
            diff.newLines.push(...range(numLinesAdded, lastNewLine + 1))
          } else { // Change occurred outside of diff
            diff.oldLines = oldLines.map(line => line + numLinesAdded);
            diff.mergeLine += numLinesAdded;
            diff.newLines = newLines.map(line => line + numLinesAdded);
          }
        });
      } else if (from.line < to.line) { // Deletion
        let deleteLine = to.line;
        let numLinesDeleted = to.line - from.line;

        diffs.forEach(diff => {
          const { oldLines, mergeLine, newLines } = diff;
          const lastLineInDiff = newLines.at(-1);

          // Deletions don't affect diffs *before* the deleteLine
          if (lastLineInDiff < deleteLine) {
            return;
          }

          if (oldLines.includes(deleteLine)) { // Change occurred in old code
            let deleteStartIndex = oldLines.indexOf(from.line);
            let deleteEndIndex = oldLines.indexOf(to.line);

            diff.oldLines = oldLines.map((line, index) => {
              if (index > deleteEndIndex) {
                return line - numLinesDeleted;
              }

              return line;
            });

            if (deleteStartIndex === -1) {
              diff.oldLines.splice(0, deleteEndIndex + 1);
            } else {
              diff.oldLines.splice(deleteStartIndex + 1, deleteEndIndex - deleteStartIndex);
            }

            diff.mergeLine -= numLinesDeleted;
            diff.newLines = newLines.map(line => line - numLinesDeleted);
          } else if (mergeLine === deleteLine) {
            // TODO: Delete the diff
            return;
          } else if (newLines.includes(deleteLine)) { // Change occurred in new code
            let deleteStartIndex = newLines.indexOf(from.line);
            let deleteEndIndex = newLines.indexOf(to.line);

            diff.newLines = newLines.map((line, index) => {
              if (index > deleteEndIndex) {
                return line - numLinesDeleted;
              }

              return line;
            });

            if (deleteStartIndex === -1) {
              diff.newLines.splice(0, deleteEndIndex + 1);
            } else {
              diff.newLines.splice(deleteStartIndex + 1, deleteEndIndex - deleteStartIndex);
            }

            // TODO: If deletion extends to or before mergeLine, delete the whole diff
          } else { // Change occurred outside of diff
            diff.oldLines = oldLines.map(line => line - numLinesDeleted);
            diff.mergeLine -= numLinesDeleted;
            diff.newLines = newLines.map(line => line - numLinesDeleted);
          }
        });
      }
    }

    this.setState({ code: newCode, diffs });
  }

  onResolveDiff(diff, linesToDelete, indicatorLineNum) {
    const { code, diffs } = this.state;
    const { id: diffId, oldCodeWidget, newCodeWidget } = diff;

    if (indicatorLineNum !== undefined) {
      let line = code[indicatorLineNum];

      if (line === OLD_CODE_LABEL || line === FIXED_CODE_LABEL) {
        linesToDelete.push(indicatorLineNum);
      }
    }

    // Delete widgets from editor
    oldCodeWidget.clear();
    newCodeWidget.clear();

    let numLinesDeleted = linesToDelete.length;
    let updatedDiffs = diffs.map((otherDiff, index) => {
      const {
        id: otherDiffId,
        oldLines,
        newLines,
        mergeLine
      } = otherDiff;

      // If diff comes before one that was resolved, no line update needed
      if (otherDiffId <= diffId) {
        return otherDiff;
      }

      // Updates line numbers in codeChange objects after lines are deleted
      otherDiff.oldLines = oldLines.map(line => line - numLinesDeleted);
      otherDiff.newLines = newLines.map(line => line - numLinesDeleted);
      otherDiff.mergeLine = mergeLine - numLinesDeleted;

      return otherDiff;
    }).filter(otherDiff => otherDiff.id != diffId);
    let updatedCode = code.filter((_, index) => !linesToDelete.includes(index));

    this.setState({ code: updatedCode, diffs: updatedDiffs });
  }

  onDebug(errorMessage) {
    this.setState({ waitingForAPI: true });

    const { code, language, apiKey } = this.state;

    let gptCode = testGPTCode;
    let { mergedCode, diffs } = diffGPTOutput(code, gptCode);

    this.setState({ code: mergedCode, diffs, errorMessage, errorExplanation: testErrorExplanation });

    // const apiConfig = new Configuration({ apiKey });
    // const api = new OpenAIApi(apiConfig);
    //
    // // let instruction = `This ${language} code throws an error.`;
    // // if (errorMessage !== "") {
    // //   instruction += `Here is the error message: ${errorMessage}.`;
    // // }
    // // instruction += "Fix it.";
    // let instruction = `Fix this error: ${errorMessage}`;
    //
    // api
  	// 	.createEdit({
  	//     ...EDIT_PROMPT_PARAMS, input: code.join("\n"), instruction
  	//   })
  	//   .then(data => {
    //     let inputCode = code.join("\n").trim().split("\n");
  	// 		let gptCode = data.data.choices[0].text.trim().replace("    ", "\t").split("\n");
    //     let { mergedCode, diffs } = diffGPTOutput(inputCode, gptCode);
    //
    //     if (errorMessage !== "") {
    //       let prompt = `Explain the following error message:\n\`\`\`\n${errorMessage}\n\`\`\``;
    //       api
    //         .createCompletion({ ...COMPLETION_PROMPT_PARAMS, prompt })
    //         .then(data => {
    //           let errorExplanation = data.data.choices[0].text;
    //           this.setState({
    //             waitingForAPI: false,
    //             code: mergedCode,
    //             diffs,
    //             errorMessage,
    //             errorExplanation
    //           });
    //         }).
    //         catch(error => console.log(error.response));
    //     } else {
    //       this.setState({
    //         waitingForAPI: false,
    //         code: mergedCode,
    //         diffs,
    //         errorMessage
    //       });
    //     }
  	// 	})
  	// 	.catch(error => console.log(error.response));
  };

  onSelectLanguage(event) { this.setState({ language: event.target.value }); }

	render() {
    const { language, code, diffs, errorExplanation, waitingForAPI } = this.state;

    return (
      <div className="app">
        <Header />
        <div className="body">
          <div className="lhs">
            <CodeEditor
              code={code}
              diffs={diffs}
              onResolveDiff={this.onResolveDiff}
              onChange={this.onCodeChange}
              language={language}
              onSelectLanguage={this.onSelectLanguage}
            />
            <ErrorMessage onDebug={this.onDebug} isLoading={waitingForAPI} />
          </div>
          <ErrorExplanation errorExplanation={errorExplanation} />
        </div>
      </div>
    );
	}
}
