const { visit, BREAK } = require('graphql/language/visitor');
const { parse } = require('graphql/language/parser');

/**
 * parseAST traverses the abstract syntax tree and creates a prototype object
 * representing all the queried fields nested as they are in the query,
 * as well as auxillary data (arguments, aliases, etc.)
 * @param {object} AST - Abstract Syntax tree generated by gql library that we will traverse to build our prototype 
 * * @param {Object} options - a field for user-supplied options
 */

// default options so parseAST doesn't have to supply everything
const defaultOptions = {
  userDefinedID: null
}

const parseAST = (AST, options = defaultOptions) => {
  // initialize prototype as empty object
  // information from AST is distilled into the prototype for easy access during caching, rebuilding query strings, etc.
  const proto= {};
  const frags = {};
  // target Object will be updated to point to prototype when iterating through Field and it will point to frags when iterating through Fragment Definition
  let targetObj;

  let operationType = '';

  // initialize stack to keep track of depth first parsing path
  const stack = [];

  // tracks depth of selection Set
  let selectionSetDepth = 0;

  // tracks arguments, aliases, etc. for specific fields
  // eventually merged with prototype object
  const fieldArgs = {};

  // extract options
  const userDefinedID = options.__userDefinedID;

  /**
   * visit is a utility provided in the graphql-JS library. It performs a
   * depth-first traversal of the abstract syntax tree, invoking a callback
   * when each SelectionSet node is entered. That function builds the prototype.
   * Invokes a callback when entering and leaving Field node to keep track of nodes with stack
   *
   * Find documentation at:
   * https://graphql.org/graphql-js/language/#visit
   */
  visit(AST, {
    enter(node) {
      if (node.directives) {
        if (node.directives.length > 0) {
          operationType = 'unQuellable';
          return BREAK;
        }
      }
    },
    OperationDefinition(node) {
      targetObj = proto;
      operationType = node.operation;
      if (node.operation === 'subscription') {
      // if (node.operation === 'subscription' || node.operation === 'mutation') {
        operationType = 'unQuellable';
        return BREAK;
      }
    },
    FragmentDefinition: {
      enter(node) {
        // update stack 
        stack.push(node.name.value);
        // point the targetObj that we update to the frags object while inside the loop
        targetObj = frags;
        // extract all fields in the fragment
        const fragName = node.name.value;
        targetObj[fragName] = {};
        // iterate through selections in selectionSet
        for (let i = 0; i < node.selectionSet.selections.length; i++) {
          // create a property for this selection on the frags obj (aka target obj)
          targetObj[fragName][node.selectionSet.selections[i].name.value] = true;
        }
      },
      leave() {
        stack.pop();
      }
    },
    Field: {
      // enter the node to construct a unique fieldType for critical fields
      enter(node) {
        // populates argsObj from current node's arguments
        // generates uniqueID from arguments
        const argsObj = {};
        // Introspection queries will not be cached
        if (node.name.value.includes('__')) {
          operationType = 'unQuellable';
          return BREAK;
        }

   
        // NOTE: type-specific options are still experimental, not integrated through Quell's lifecycle
        // non-viable options should not break system but /shouldn't change app behavior/
        // auxillary object for storing arguments, aliases, type-specific options, and more
        // query-wide options should be handled on Quell's options object
        const auxObj = {
          __id: null,
        };

        node.arguments.forEach(arg => {
          const key = arg.name.value;
          if (arg.value.kind === 'Variable' && operationType === 'query') {
            operationType = 'unQuellable';
            return BREAK;
          }
          // assign args to argsObj, skipping type-specific options ('__')
          if (!key.includes('__')) {
            argsObj[key] = arg.value.value;
          };

          // identify uniqueID from args, options
          // note: does not use key.includes('id') to avoid automatically assigning fields such as "idea" or "idiom"
          if (userDefinedID ? key === userDefinedID : false) {
            // assigns ID as userDefinedID if one is supplied on options object
            auxObj.__id = arg.value.value;
          } else if (key === 'id' || key === '_id' || key === 'ID' || key === 'Id') {
            // assigns ID automatically from args
            auxObj.__id = arg.value.value;
          }

          // handle custom options passed in as arguments (ie customCache)
          if (key.includes('__')) {
            auxObj[key] = arg.value.value;
          }
        });

        // specifies whether field is stored as fieldType or Alias Name
        const fieldType = node.alias ? node.alias.value : node.name.value;

        // stores node Field Type on aux object, 
        // always stored as lowerCase to ensure consistent caching
        auxObj.__type = node.name.value.toLowerCase();

        // stores alias for Field on auxillary object
        auxObj.__alias = node.alias ? node.alias.value : null;

        // if argsObj has no values, set as null, then set on auxObj
        auxObj.__args = Object.keys(argsObj).length > 0 ? argsObj : null;

        // adds auxObj fields to prototype, allowing future access to type, alias, args, etc.
        fieldArgs[fieldType] = {
          ...fieldArgs[fieldType],
          ...auxObj
        };

        // add value to stacks to keep track of depth-first parsing path
        stack.push(fieldType);
      },
      leave() {
        // pop stacks to keep track of depth-first parsing path
        stack.pop();
      },
    },
    SelectionSet: {
      // selection sets contain all of the sub-fields
      // iterate through the sub-fields to construct fieldsObject
      enter(node, key, parent, path, ancestors) {
        selectionSetDepth++;

      /* Exclude SelectionSet nodes whose parents' are not of the kind
       * 'Field' to exclude nodes that do not contain information about
       *  queried fields.
       */
        if (parent.kind === 'Field') {
          // loop through selections to collect fields
          const fieldsValues = {};
          for (let field of node.selections) {
            // sets any fields values to true
            // UNLESS they are a nested object
            if (!field.selectionSet) fieldsValues[field.name.value] = true;
          };
          
          // if ID was not included on the request then the query will not be included in the cache, but the request will be processed
          if (!fieldsValues.hasOwnProperty('id') && !fieldsValues.hasOwnProperty('_id') && !fieldsValues.hasOwnProperty('ID') && !fieldsValues.hasOwnProperty('Id')) {
            operationType = 'unQuellable';
            return BREAK;
          }
          // place fieldArgs object onto fieldsObject so it gets passed along to prototype
          // fieldArgs contains arguments, aliases, etc.
          const fieldsObject = { ...fieldsValues, ...fieldArgs[stack[stack.length - 1]] };

          // loop through stack to get correct path in proto for temp object;
          // mutates original prototype object WITH values from tempObject
          // "prev" is accumulator ie the prototype
          stack.reduce((prev, curr, index) => {
            return index + 1 === stack.length // if last item in path
              ? (prev[curr] = {...fieldsObject}) //set value
              : (prev[curr] = prev[curr]); // otherwise, if index exists, keep value
          }, targetObj);
        }
      },
      leave() {
        // tracking depth of selection set
        selectionSetDepth--;
      },
    },
  });
  return { proto, operationType, frags };
};


module.exports = parseAST;
