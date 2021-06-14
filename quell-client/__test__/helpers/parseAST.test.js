const parseAST = require('../../src/helpers/parseAST');
const { parse } = require('graphql/language/parser');

xdescribe('parseAST.js', () => {
  test('should traverses the abstract syntax tree and creates a prototype object', () => {
    const query = `query {
      countries {
        id
        name
        capital
      }
    }`;
    const parsedQuery = parse(query);
    const { proto, protoArgs, operationType } = parseAST(parsedQuery);
    expect(proto).toEqual({
      countries: {
        id: true,
        name: true,
        capital: true,
      },
    });
  });

  test('should work with arguments', () => {
    const query = `query {
      countries(id: 1) {
        id
        name
        capital
      }
    }`;
    const parsedQuery = parse(query);
    const { proto, protoArgs, operationType } = parseAST(parsedQuery);
    expect(proto).toEqual({
      countries: {
        id: true,
        name: true,
        capitol: true,
      },
    });
    expect(protoArgs).toEqual(null);
    expect(operationType).toEqual('query');
  });

  test('should return a prototype from a nested query', () => {
    const query = `{countries { id name capital cities  { id country_id name population  } } }`;
    const AST = parse(query);
    const { prototype, protoArgs, operationType } = parseAST(AST);


    expect(prototype).toEqual({
      countries: {
        id: true,
        name: true,
        capital: true,
        cities: { id: true, country_id: true, name: true, population: true },
      },
    });
    expect(protoArgs).toEqual(null);
    expect(operationType).toEqual('query');
  });

  test('should return an arguments object', () => {
    const query = `{ country (id: 1) { id name population } }`;
    const AST = parse(query);
    const { prototype, protoArgs, operationType } = parseAST(AST);

    expect(prototype).toEqual({
        country: {
          id: true,
          name: true,
          population: true
        }
      }
    );
    expect(protoArgs).toEqual({ country: { fieldName: 'country', id: "1" }});
    expect(operationType).toEqual('query');
  });

  // protoArgs = { alias: { fieldName: 'name', id: '1' } }
  test('should work with alias', () => {
    // produces prototype valid
    // identifies query type
    // save alias map on args object
    // doesn't overwrite arguments
    // doesn't overwrite other queries
    const query = `{
      Canada: country (id: 1) {
        id
        name
        capitol
      }
  }`;
    const AST = parse(query);
    const { prototype, protoArgs, operationType } = parseAST(AST);

    expect(prototype).toEqual({
      Canada: {
        id: true,
        name: true,
        capitol: true
      }
    });
    expect(protoArgs).toEqual({
      Canada: { fieldName: "country", id: "1" }
    });
    expect(operationType).toEqual('query');
  });

  test('should create prototype object for multiple queries', () => {
    const query = `{
      countries { 
        id 
        name 
        capital 
      } 
      book {
        name
        genre
      }
    }`;
    const parsedQuery = parse(query);
    const { proto, protoArgs, operationType } = parseAST(parsedQuery);

    expect(proto).toEqual({
      countries: { 
        id: true,
        name: true, 
        capital: true, 
      }, 
      book: {
        name: true,
        genre: true
      },
    });
  });

  test('should create prototype object for multiple nested queries', () => {
    const query = `{
      countries { 
        id 
        name 
        cities {
          name
        } 
      } 
      book {
        name
        genre
        similarBooks {
          name
        }
      }
    }`;
    const parsedQuery = parse(query);
    const { proto, protoArgs, operationType } = parseAST(parsedQuery);

    expect(proto).toEqual({
      countries: { 
        id: true,
        name: true, 
        cities: {
          name: true,
        }
      }, 
      book: {
        name: true,
        genre: true,
        similarBooks: {
          name: true,
        }
      },
    });
    expect(operationType).toBe('query');
  });
});

